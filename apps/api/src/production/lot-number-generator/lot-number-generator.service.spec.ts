import { Test, TestingModule } from '@nestjs/testing';
import { LotNumberGeneratorService } from './lot-number-generator.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  LotNumberConversionError,
  LotNumberCounterInconsistentError,
  LotNumberCounterNotFoundError,
} from './lot-number-generator.errors';
import type { Prisma } from '../../../generated/prisma/client';

describe('LotNumberGeneratorService', () => {
  let service: LotNumberGeneratorService;
  let prisma: { lot: { count: jest.Mock } };

  const siteId = 'site-1';

  beforeEach(async () => {
    prisma = { lot: { count: jest.fn() } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LotNumberGeneratorService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(LotNumberGeneratorService);
  });

  it('génère 455001 pour le premier lot du site', async () => {
    prisma.lot.count.mockResolvedValue(0);

    const lotNumber = await service.generate(siteId);

    expect(lotNumber).toBe('455001');
    expect(prisma.lot.count).toHaveBeenCalledWith({ where: { siteId } });
  });

  it('incrémente correctement à partir du nombre de lots déjà existants', async () => {
    prisma.lot.count.mockResolvedValue(41);

    const lotNumber = await service.generate(siteId);

    expect(lotNumber).toBe('455042');
  });

  it('utilise le client fourni (ex : client transactionnel) au lieu de PrismaService par défaut', async () => {
    const txClient = { lot: { count: jest.fn().mockResolvedValue(9) } };

    const lotNumber = await service.generate(siteId, txClient);

    expect(lotNumber).toBe('455010');
    expect(prisma.lot.count).not.toHaveBeenCalled();
    expect(txClient.lot.count).toHaveBeenCalledWith({ where: { siteId } });
  });
});

/**
 * `reserveLotNumber` — mécanisme nominal (ADR 0010 § Décisions 5/9/10/21).
 *
 * Ces tests unitaires couvrent uniquement la logique de décision (réutilisation vs
 * incrémentation, compteur absent, défense en profondeur sur une valeur de compteur
 * incohérente qu'aucune donnée PostgreSQL réelle ne peut produire — la colonne est
 * un `Int` natif). Le comportement de verrouillage réel (`SELECT ... FOR UPDATE`,
 * concurrence, rollback, multi-site) est prouvé exclusivement contre une vraie base
 * PostgreSQL dans `test/lot-number-generator.e2e-spec.ts` — un mock ne prouve jamais
 * l'atomicité ni l'exclusion mutuelle.
 */
describe('LotNumberGeneratorService.reserveLotNumber (unitaire, tx mocké)', () => {
  let service: LotNumberGeneratorService;

  const siteId = 'site-1';
  const batchId = 'batch-1';

  function createTxMock(
    queryRawResult: unknown[],
  ): jest.Mocked<
    Pick<Prisma.TransactionClient, '$queryRaw' | 'lotNumberCounter'>
  > {
    return {
      $queryRaw: jest.fn().mockResolvedValue(queryRawResult),
      lotNumberCounter: {
        update: jest.fn().mockResolvedValue(undefined),
      },
    } as unknown as jest.Mocked<
      Pick<Prisma.TransactionClient, '$queryRaw' | 'lotNumberCounter'>
    >;
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LotNumberGeneratorService,
        { provide: PrismaService, useValue: {} },
      ],
    }).compile();

    service = module.get(LotNumberGeneratorService);
  });

  it('incrémente lastIssuedNumber quand la réutilisation est indisponible', async () => {
    const tx = createTxMock([
      { lastIssuedNumber: 456148, lastIssuedAvailableForReuse: false },
    ]);

    const lotNumber = await service.reserveLotNumber(
      siteId,
      batchId,
      tx as unknown as Prisma.TransactionClient,
    );

    expect(lotNumber).toBe('456149');
    expect(tx.lotNumberCounter.update).toHaveBeenCalledWith({
      where: { siteId },
      data: {
        lastIssuedNumber: 456149,
        lastIssuedBatchId: batchId,
        lastIssuedAvailableForReuse: false,
      },
    });
  });

  it('réutilise exactement lastIssuedNumber sans incrémenter quand la réutilisation est disponible', async () => {
    const tx = createTxMock([
      { lastIssuedNumber: 456148, lastIssuedAvailableForReuse: true },
    ]);

    const lotNumber = await service.reserveLotNumber(
      siteId,
      batchId,
      tx as unknown as Prisma.TransactionClient,
    );

    expect(lotNumber).toBe('456148');
    expect(tx.lotNumberCounter.update).toHaveBeenCalledWith({
      where: { siteId },
      data: {
        lastIssuedNumber: 456148,
        lastIssuedBatchId: batchId,
        lastIssuedAvailableForReuse: false,
      },
    });
  });

  it('lève LotNumberCounterNotFoundError si aucun compteur n’existe pour le site, sans écriture', async () => {
    const tx = createTxMock([]);

    await expect(
      service.reserveLotNumber(
        siteId,
        batchId,
        tx as unknown as Prisma.TransactionClient,
      ),
    ).rejects.toThrow(/Aucun compteur de numérotation de lot initialisé/);
    expect(tx.lotNumberCounter.update).not.toHaveBeenCalled();
  });

  it('lève LotNumberConversionError si lastIssuedNumber lu n’est pas un entier sûr (défense en profondeur, état inatteignable via une colonne Int réelle)', async () => {
    const tx = createTxMock([
      { lastIssuedNumber: '456148abc', lastIssuedAvailableForReuse: false },
    ]);

    await expect(
      service.reserveLotNumber(
        siteId,
        batchId,
        tx as unknown as Prisma.TransactionClient,
      ),
    ).rejects.toThrow(LotNumberConversionError);
    expect(tx.lotNumberCounter.update).not.toHaveBeenCalled();
  });
});

/**
 * `releaseLotNumber` — libération conditionnelle à l'annulation (ADR 0010 §
 * Décisions 9/11). Logique de décision testée ici avec un `tx` mocké ; le
 * verrouillage réel (`FOR UPDATE`), la concurrence et le rollback sont prouvés
 * exclusivement contre une vraie base PostgreSQL (`test/batch-cancel.e2e-spec.ts`).
 */
describe('LotNumberGeneratorService.releaseLotNumber (unitaire, tx mocké)', () => {
  let service: LotNumberGeneratorService;

  const siteId = 'site-1';
  const batchId = 'batch-1';

  function createTxMock(
    queryRawResult: unknown[],
  ): jest.Mocked<
    Pick<Prisma.TransactionClient, '$queryRaw' | 'lotNumberCounter'>
  > {
    return {
      $queryRaw: jest.fn().mockResolvedValue(queryRawResult),
      lotNumberCounter: {
        update: jest.fn().mockResolvedValue(undefined),
      },
    } as unknown as jest.Mocked<
      Pick<Prisma.TransactionClient, '$queryRaw' | 'lotNumberCounter'>
    >;
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LotNumberGeneratorService,
        { provide: PrismaService, useValue: {} },
      ],
    }).compile();

    service = module.get(LotNumberGeneratorService);
  });

  it('marque le compteur réutilisable et retourne true quand le numéro libéré est très exactement le dernier émis pour ce batch', async () => {
    const tx = createTxMock([
      {
        lastIssuedNumber: 456149,
        lastIssuedBatchId: batchId,
        lastIssuedAvailableForReuse: false,
      },
    ]);

    const reusable = await service.releaseLotNumber(
      siteId,
      batchId,
      '456149',
      tx as unknown as Prisma.TransactionClient,
    );

    expect(reusable).toBe(true);
    expect(tx.lotNumberCounter.update).toHaveBeenCalledWith({
      where: { siteId },
      data: { lastIssuedAvailableForReuse: true },
    });
  });

  it('ne modifie jamais le compteur et retourne false pour un numéro intermédiaire déjà dépassé', async () => {
    const tx = createTxMock([
      {
        lastIssuedNumber: 456150,
        lastIssuedBatchId: 'batch-plus-recent',
        lastIssuedAvailableForReuse: false,
      },
    ]);

    const reusable = await service.releaseLotNumber(
      siteId,
      batchId,
      '456149',
      tx as unknown as Prisma.TransactionClient,
    );

    expect(reusable).toBe(false);
    expect(tx.lotNumberCounter.update).not.toHaveBeenCalled();
  });

  it('lève LotNumberCounterInconsistentError si le numéro correspond au dernier émis mais pour un autre batch, sans jamais modifier le compteur', async () => {
    const tx = createTxMock([
      {
        lastIssuedNumber: 456149,
        lastIssuedBatchId: 'un-autre-batch',
        lastIssuedAvailableForReuse: false,
      },
    ]);

    await expect(
      service.releaseLotNumber(
        siteId,
        batchId,
        '456149',
        tx as unknown as Prisma.TransactionClient,
      ),
    ).rejects.toThrow(LotNumberCounterInconsistentError);
    expect(tx.lotNumberCounter.update).not.toHaveBeenCalled();
  });

  it('lève LotNumberCounterNotFoundError si aucun compteur n’existe pour le site, sans écriture (état défensif)', async () => {
    const tx = createTxMock([]);

    await expect(
      service.releaseLotNumber(
        siteId,
        batchId,
        '456149',
        tx as unknown as Prisma.TransactionClient,
      ),
    ).rejects.toThrow(LotNumberCounterNotFoundError);
    expect(tx.lotNumberCounter.update).not.toHaveBeenCalled();
  });

  it('lève LotNumberConversionError si reservedLotNumber n’est pas strictement numérique (fail-closed, jamais une comparaison lexicographique)', async () => {
    const tx = createTxMock([
      {
        lastIssuedNumber: 456149,
        lastIssuedBatchId: batchId,
        lastIssuedAvailableForReuse: false,
      },
    ]);

    await expect(
      service.releaseLotNumber(
        siteId,
        batchId,
        '456149abc',
        tx as unknown as Prisma.TransactionClient,
      ),
    ).rejects.toThrow(LotNumberConversionError);
    expect(tx.lotNumberCounter.update).not.toHaveBeenCalled();
  });
});
