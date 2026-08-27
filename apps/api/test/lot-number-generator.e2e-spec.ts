import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { LotNumberGeneratorService } from '../src/production/lot-number-generator/lot-number-generator.service';
import { LotNumberCounterNotFoundError } from '../src/production/lot-number-generator/lot-number-generator.errors';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createDeferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/**
 * Attend qu'une session PostgreSQL distincte soit réellement bloquée en attente du
 * verrou `FOR UPDATE` sur `lot_number_counters` — la seule façon de prouver un
 * chevauchement transactionnel réel (un `Promise.all()` seul ne le prouve jamais,
 * voir ADR 0010 § Plan de tests).
 */
async function waitUntilBlockedOnLock(
  prisma: PrismaService,
  timeoutMs = 5000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const rows = await prisma.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM pg_stat_activity
      WHERE wait_event_type = 'Lock'
        AND query ILIKE '%lot_number_counters%'
        AND pid <> pg_backend_pid()
    `;
    if ((rows[0]?.count ?? 0) > 0) {
      return;
    }
    await sleep(25);
  }
  throw new Error(
    "Timeout : la seconde transaction n'a jamais été observée en attente du verrou FOR UPDATE sur lot_number_counters — le test ne prouve pas un chevauchement réel.",
  );
}

/**
 * Preuve contre une vraie base PostgreSQL (voir ADR 0010 § Décisions 8/9/10/21) du
 * mécanisme nominal `LotNumberGeneratorService.reserveLotNumber` : verrouillage réel
 * (`SELECT ... FOR UPDATE`), attribution/réutilisation, rollback tardif, compteur
 * absent, indépendance multi-site. Aucun appelant ne câble encore cette méthode dans
 * le flux métier (étape ultérieure, `BatchStepsService`) — ce fichier teste le
 * service directement, sans passer par un endpoint HTTP.
 */
describe('LotNumberGeneratorService.reserveLotNumber (e2e, PostgreSQL réel)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let service: LotNumberGeneratorService;

  let siteAId: string;
  let siteBId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    service = app.get(LotNumberGeneratorService);

    const siteA = await prisma.site.create({
      data: { name: 'Site e2e lot-number-generator A' },
    });
    const siteB = await prisma.site.create({
      data: { name: 'Site e2e lot-number-generator B' },
    });
    siteAId = siteA.id;
    siteBId = siteB.id;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.lotNumberCounter.deleteMany({
        where: { siteId: { in: [siteAId, siteBId] } },
      });
      await prisma.site.deleteMany({
        where: { id: { in: [siteAId, siteBId] } },
      });
    }
    await app?.close();
  });

  beforeEach(async () => {
    await prisma.lotNumberCounter.deleteMany({
      where: { siteId: { in: [siteAId, siteBId] } },
    });
  });

  it('attribue lastIssuedNumber + 1 quand la réutilisation est indisponible', async () => {
    await prisma.lotNumberCounter.create({
      data: {
        siteId: siteAId,
        lastIssuedNumber: 456148,
        lastIssuedAvailableForReuse: false,
      },
    });

    const lotNumber = await prisma.$transaction((tx) =>
      service.reserveLotNumber(siteAId, 'batch-attribution-simple', tx),
    );

    expect(lotNumber).toBe('456149');

    const counter = await prisma.lotNumberCounter.findUniqueOrThrow({
      where: { siteId: siteAId },
    });
    expect(counter.lastIssuedNumber).toBe(456149);
    expect(counter.lastIssuedBatchId).toBe('batch-attribution-simple');
    expect(counter.lastIssuedAvailableForReuse).toBe(false);
  });

  it('réutilise exactement le dernier numéro sans l’incrémenter quand il est disponible', async () => {
    await prisma.lotNumberCounter.create({
      data: {
        siteId: siteAId,
        lastIssuedNumber: 456148,
        lastIssuedAvailableForReuse: true,
      },
    });

    const lotNumber = await prisma.$transaction((tx) =>
      service.reserveLotNumber(siteAId, 'batch-reutilisation', tx),
    );

    expect(lotNumber).toBe('456148');

    const counter = await prisma.lotNumberCounter.findUniqueOrThrow({
      where: { siteId: siteAId },
    });
    expect(counter.lastIssuedNumber).toBe(456148);
    expect(counter.lastIssuedBatchId).toBe('batch-reutilisation');
    expect(counter.lastIssuedAvailableForReuse).toBe(false);
  });

  it('n’expose jamais un numéro intermédiaire libéré : incrémente depuis lastIssuedNumber sans jamais scanner Lot', async () => {
    // Simule l'état d'un compteur après qu'un numéro intermédiaire (ex. 456148) a été
    // libéré puis dépassé par l'émission d'un numéro plus récent (456150) : la seule
    // source de vérité consultée est l'état courant du compteur, jamais un balayage de
    // la table Lot (qui n'existe même pas dans ce test — aucun Lot n'est créé).
    await prisma.lotNumberCounter.create({
      data: {
        siteId: siteAId,
        lastIssuedNumber: 456150,
        lastIssuedAvailableForReuse: false,
      },
    });

    const lotNumber = await prisma.$transaction((tx) =>
      service.reserveLotNumber(siteAId, 'batch-numero-intermediaire', tx),
    );

    expect(lotNumber).toBe('456151');
  });

  it('lève LotNumberCounterNotFoundError si aucun compteur n’existe pour le site, sans aucune écriture', async () => {
    await expect(
      prisma.$transaction((tx) =>
        service.reserveLotNumber(siteAId, 'batch-compteur-absent', tx),
      ),
    ).rejects.toThrow(LotNumberCounterNotFoundError);

    const rows = await prisma.lotNumberCounter.findMany({
      where: { siteId: siteAId },
    });
    expect(rows).toHaveLength(0);
  });

  it('rollback tardif : restaure exactement l’état antérieur du compteur, aucun numéro consommé', async () => {
    await prisma.lotNumberCounter.create({
      data: {
        siteId: siteAId,
        lastIssuedNumber: 700,
        lastIssuedAvailableForReuse: false,
      },
    });

    await expect(
      prisma.$transaction(async (tx) => {
        const number = await service.reserveLotNumber(
          siteAId,
          'batch-rollback-tardif',
          tx,
        );
        expect(number).toBe('701');
        // Écriture réelle déjà effectuée (compteur verrouillé et mis à jour) avant
        // cette erreur artificielle — le rollback doit donc annuler une écriture
        // effective, pas simplement empêcher une écriture qui n'aurait jamais eu lieu.
        throw new Error('Erreur artificielle pour forcer le rollback tardif');
      }),
    ).rejects.toThrow('Erreur artificielle pour forcer le rollback tardif');

    const counter = await prisma.lotNumberCounter.findUniqueOrThrow({
      where: { siteId: siteAId },
    });
    expect(counter.lastIssuedNumber).toBe(700);
    expect(counter.lastIssuedBatchId).toBeNull();
    expect(counter.lastIssuedAvailableForReuse).toBe(false);
  });

  it('deux sites différents avec le même point de départ obtiennent chacun leur propre numéro, sans collision ni rejet à tort', async () => {
    await prisma.lotNumberCounter.create({
      data: {
        siteId: siteAId,
        lastIssuedNumber: 600,
        lastIssuedAvailableForReuse: false,
      },
    });
    await prisma.lotNumberCounter.create({
      data: {
        siteId: siteBId,
        lastIssuedNumber: 600,
        lastIssuedAvailableForReuse: false,
      },
    });

    const [numberA, numberB] = await Promise.all([
      prisma.$transaction((tx) =>
        service.reserveLotNumber(siteAId, 'batch-site-a', tx),
      ),
      prisma.$transaction((tx) =>
        service.reserveLotNumber(siteBId, 'batch-site-b', tx),
      ),
    ]);

    expect(numberA).toBe('601');
    expect(numberB).toBe('601');

    const counterA = await prisma.lotNumberCounter.findUniqueOrThrow({
      where: { siteId: siteAId },
    });
    const counterB = await prisma.lotNumberCounter.findUniqueOrThrow({
      where: { siteId: siteBId },
    });
    expect(counterA.lastIssuedNumber).toBe(601);
    expect(counterB.lastIssuedNumber).toBe(601);
  });

  it(
    'deux transactions concurrentes sur le MÊME site ne peuvent jamais obtenir le même numéro ' +
      '(verrou FOR UPDATE réel, chevauchement prouvé via pg_stat_activity)',
    async () => {
      await prisma.lotNumberCounter.create({
        data: {
          siteId: siteAId,
          lastIssuedNumber: 500,
          lastIssuedAvailableForReuse: false,
        },
      });

      const tx1Locked = createDeferred<void>();
      const releaseTx1 = createDeferred<void>();

      const tx1Promise = prisma.$transaction(
        async (tx) => {
          const number = await service.reserveLotNumber(
            siteAId,
            'batch-concurrent-1',
            tx,
          );
          // Le verrou est acquis et le compteur déjà mis à jour à ce point : on
          // signale au test principal, puis on retient volontairement le COMMIT pour
          // garantir que la seconde transaction se présente pendant que le verrou est
          // encore détenu.
          tx1Locked.resolve();
          await releaseTx1.promise;
          return number;
        },
        { timeout: 10000, maxWait: 10000 },
      );

      await tx1Locked.promise;

      const tx2Promise = prisma.$transaction(
        (tx) => service.reserveLotNumber(siteAId, 'batch-concurrent-2', tx),
        { timeout: 10000, maxWait: 10000 },
      );

      // Preuve du chevauchement réel : la seconde transaction doit être observée
      // réellement bloquée en attente du verrou avant qu'on laisse la première
      // committer — sans cette vérification, un code buggé sans FOR UPDATE pourrait
      // faire passer ce test par pure chance de séquencement.
      await waitUntilBlockedOnLock(prisma);

      releaseTx1.resolve();

      const [number1, number2] = await Promise.all([tx1Promise, tx2Promise]);

      expect(number1).toBe('501');
      expect(number2).toBe('502');
      expect(new Set([number1, number2]).size).toBe(2);

      const finalCounter = await prisma.lotNumberCounter.findUniqueOrThrow({
        where: { siteId: siteAId },
      });
      expect(finalCounter.lastIssuedNumber).toBe(502);
      expect(finalCounter.lastIssuedBatchId).toBe('batch-concurrent-2');
    },
    15000,
  );
});
