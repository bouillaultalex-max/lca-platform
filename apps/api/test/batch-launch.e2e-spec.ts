import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { BatchStepsService } from '../src/production/batch-steps/batch-steps.service';
import { AuditLogService } from '../src/audit-log/audit-log.service';
import { LotNumberCounterNotFoundError } from '../src/production/lot-number-generator/lot-number-generator.errors';
import {
  ArticleType,
  AuditAction,
  BatchStatus,
  BatchStep,
  UserRole,
} from '../generated/prisma/client';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Attend qu'une session PostgreSQL distincte soit réellement bloquée en attente du
 * verrou `FOR UPDATE` sur `batches` — seule preuve valable d'un chevauchement
 * transactionnel réel entre deux appels `advance()` (voir ADR 0010 § Plan de tests :
 * un `Promise.all()` seul ne le prouve jamais).
 */
async function waitUntilBatchLockContested(
  prisma: PrismaService,
  timeoutMs = 4000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const rows = await prisma.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM pg_stat_activity
      WHERE wait_event_type = 'Lock'
        AND query ILIKE '%FROM batches%FOR UPDATE%'
        AND pid <> pg_backend_pid()
    `;
    if ((rows[0]?.count ?? 0) > 0) {
      return true;
    }
    await sleep(2);
  }
  return false;
}

interface SiteFixture {
  siteId: string;
  recipeId: string;
  machineId: string;
  userId: string;
}

/**
 * Preuve contre une vraie base PostgreSQL (voir ADR 0010 § Décisions 8/9/10/12/13/19)
 * du lancement transactionnel `BatchStepsService.advance()` (PLANIFIE → EN_COURS) :
 * verrou `Batch` avant verrou `LotNumberCounter`, attribution du numéro et de la DDM,
 * AuditLog, concurrence réelle, rollback tardif, compteur absent, multi-site. Appel
 * direct du service (pas de HTTP/supertest) : ce fichier teste la mécanique
 * transactionnelle, pas la couche HTTP déjà couverte par `production.e2e-spec.ts`.
 *
 * Les recettes utilisées ici sont volontairement sans aucune `RecipeLine` : la
 * faisabilité est donc trivialement satisfaite (aucun ingrédient à vérifier), ce qui
 * isole complètement le test du calcul de faisabilité lui-même (déjà couvert par
 * `production.e2e-spec.ts`) pour se concentrer sur le mécanisme de numérotation.
 */
describe('BatchStepsService.advance — lancement PLANIFIE → EN_COURS (e2e, PostgreSQL réel)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let service: BatchStepsService;
  let auditLogService: AuditLogService;

  let siteA: SiteFixture;
  let siteB: SiteFixture;
  let siteC: SiteFixture; // Volontairement sans LotNumberCounter (voir tests dédiés).

  const startingCounterValue = 800000;

  async function setupSite(label: string): Promise<SiteFixture> {
    const site = await prisma.site.create({
      data: { name: `Site e2e batch-launch ${label}` },
    });

    const product = await prisma.article.create({
      data: {
        siteId: site.id,
        type: ArticleType.PRODUIT_FINI,
        openSiReference: `E2E-BL-${label}-PRODUIT`,
        name: `Produit fini e2e batch-launch ${label}`,
        unitOfMeasure: 'unité',
        currentUnitCost: 1,
      },
    });

    const machine = await prisma.machine.create({
      data: {
        siteId: site.id,
        name: `Machine e2e batch-launch ${label}`,
        supportedFormats: [100],
      },
    });

    // Aucune RecipeLine : faisabilité trivialement satisfaite (voir doc du describe).
    const recipe = await prisma.recipe.create({
      data: {
        siteId: site.id,
        finishedProductId: product.id,
        format: 100,
        version: 1,
      },
    });

    const user = await prisma.user.create({
      data: {
        siteId: site.id,
        fullName: `Utilisateur e2e batch-launch ${label}`,
        email: `e2e-batch-launch-${label.toLowerCase()}@lca-mes.local`,
        passwordHash: 'not-used-in-this-suite',
        role: UserRole.RESPONSABLE_LABORATOIRE,
      },
    });

    return {
      siteId: site.id,
      recipeId: recipe.id,
      machineId: machine.id,
      userId: user.id,
    };
  }

  async function createLaunchableBatch(
    site: SiteFixture,
    plannedQuantity = 100,
  ): Promise<string> {
    const batch = await prisma.batch.create({
      data: {
        siteId: site.siteId,
        recipeId: site.recipeId,
        machineId: site.machineId,
        format: 100,
        plannedQuantity,
        status: BatchStatus.PLANIFIE,
        createdByUserId: site.userId,
      },
    });
    return batch.id;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    service = app.get(BatchStepsService);
    auditLogService = app.get(AuditLogService);

    siteA = await setupSite('A');
    siteB = await setupSite('B');
    siteC = await setupSite('C');

    await prisma.lotNumberCounter.create({
      data: { siteId: siteA.siteId, lastIssuedNumber: startingCounterValue },
    });
    await prisma.lotNumberCounter.create({
      data: { siteId: siteB.siteId, lastIssuedNumber: startingCounterValue },
    });
    // Aucun LotNumberCounter pour siteC — voir « compteur absent » ci-dessous.
  });

  afterAll(async () => {
    if (prisma) {
      const siteIds = [siteA?.siteId, siteB?.siteId, siteC?.siteId].filter(
        (id): id is string => Boolean(id),
      );
      await prisma.auditLog.deleteMany({
        where: { entity: 'Batch' },
      });
      await prisma.batch.deleteMany({ where: { siteId: { in: siteIds } } });
      await prisma.lotNumberCounter.deleteMany({
        where: { siteId: { in: siteIds } },
      });
      await prisma.recipe.deleteMany({ where: { siteId: { in: siteIds } } });
      await prisma.machine.deleteMany({ where: { siteId: { in: siteIds } } });
      await prisma.article.deleteMany({ where: { siteId: { in: siteIds } } });
      await prisma.user.deleteMany({ where: { siteId: { in: siteIds } } });
      await prisma.site.deleteMany({ where: { id: { in: siteIds } } });
    }
    await app?.close();
  });

  it('lancement réussi : attribue le numéro et la DDM, journalise, ne crée ni Lot ni BatchCost ni LotGenealogy', async () => {
    const batchId = await createLaunchableBatch(siteA);

    const updated = await service.advance(siteA.siteId, batchId, siteA.userId);

    expect(updated.status).toBe(BatchStatus.EN_COURS);
    expect(updated.currentStep).toBe(BatchStep.PREPARATION);
    expect(updated.reservedLotNumber).toBe(
      String(startingCounterValue + 1),
    );
    expect(updated.reservedExpiryDate).not.toBeNull();
    expect(updated.startedAt).not.toBeNull();
    expect(updated.reservedExpiryDate!.getUTCFullYear()).toBe(
      updated.startedAt!.getUTCFullYear() + 3,
    );

    const counter = await prisma.lotNumberCounter.findUniqueOrThrow({
      where: { siteId: siteA.siteId },
    });
    expect(counter.lastIssuedNumber).toBe(startingCounterValue + 1);
    expect(counter.lastIssuedBatchId).toBe(batchId);
    expect(counter.lastIssuedAvailableForReuse).toBe(false);

    const auditLogs = await prisma.auditLog.findMany({
      where: { entity: 'Batch', entityId: batchId, action: AuditAction.UPDATE },
    });
    expect(auditLogs).toHaveLength(1);
    expect((auditLogs[0].after as { reservedLotNumber: string })
      .reservedLotNumber).toBe(String(startingCounterValue + 1));

    const lots = await prisma.lot.findMany({ where: { batchId } });
    expect(lots).toHaveLength(0);
    const batchCosts = await prisma.batchCost.findMany({ where: { batchId } });
    expect(batchCosts).toHaveLength(0);
    const genealogies = await prisma.lotGenealogy.findMany({
      where: { lot: { batchId } },
    });
    expect(genealogies).toHaveLength(0);
  });

  it(
    'deux advance() concurrents sur le MÊME Batch PLANIFIE : un seul succès, un seul numéro, ' +
      'aucun second numéro consommé (chevauchement prouvé via pg_stat_activity)',
    async () => {
      const batchId = await createLaunchableBatch(siteA);
      const counterBefore = await prisma.lotNumberCounter.findUniqueOrThrow({
        where: { siteId: siteA.siteId },
      });

      const resultsPromise = Promise.allSettled([
        service.advance(siteA.siteId, batchId, siteA.userId),
        service.advance(siteA.siteId, batchId, siteA.userId),
      ]);

      const contested = await waitUntilBatchLockContested(prisma);
      const [r1, r2] = await resultsPromise;

      expect(contested).toBe(true);

      const outcomes = [r1, r2];
      const successCount = outcomes.filter(
        (r) => r.status === 'fulfilled',
      ).length;
      const failed = outcomes.find(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );
      expect(successCount).toBe(1);
      expect(failed).toBeDefined();
      expect((failed!.reason as Error).message).toBe(
        'Ce batch a déjà été lancé.',
      );

      const finalBatch = await prisma.batch.findUniqueOrThrow({
        where: { id: batchId },
      });
      expect(finalBatch.status).toBe(BatchStatus.EN_COURS);
      expect(finalBatch.reservedLotNumber).toBe(
        String(counterBefore.lastIssuedNumber + 1),
      );

      const finalCounter = await prisma.lotNumberCounter.findUniqueOrThrow({
        where: { siteId: siteA.siteId },
      });
      expect(finalCounter.lastIssuedNumber).toBe(
        counterBefore.lastIssuedNumber + 1,
      );
      expect(finalCounter.lastIssuedBatchId).toBe(batchId);

      const auditLogs = await prisma.auditLog.findMany({
        where: {
          entity: 'Batch',
          entityId: batchId,
          action: AuditAction.UPDATE,
        },
      });
      expect(auditLogs).toHaveLength(1);
    },
    15000,
  );

  it('deux Batch PLANIFIE différents, même site : lancés sans collision, deux numéros distincts, deux AuditLogs', async () => {
    const counterBefore = await prisma.lotNumberCounter.findUniqueOrThrow({
      where: { siteId: siteA.siteId },
    });
    const batchIdA = await createLaunchableBatch(siteA);
    const batchIdB = await createLaunchableBatch(siteA);

    const [updatedA, updatedB] = await Promise.all([
      service.advance(siteA.siteId, batchIdA, siteA.userId),
      service.advance(siteA.siteId, batchIdB, siteA.userId),
    ]);

    expect(updatedA.status).toBe(BatchStatus.EN_COURS);
    expect(updatedB.status).toBe(BatchStatus.EN_COURS);
    expect(updatedA.reservedLotNumber).not.toBe(updatedB.reservedLotNumber);

    const numbers = [updatedA.reservedLotNumber, updatedB.reservedLotNumber]
      .map(Number)
      .sort((a, b) => a - b);
    expect(numbers).toEqual([
      counterBefore.lastIssuedNumber + 1,
      counterBefore.lastIssuedNumber + 2,
    ]);

    const finalCounter = await prisma.lotNumberCounter.findUniqueOrThrow({
      where: { siteId: siteA.siteId },
    });
    expect(finalCounter.lastIssuedNumber).toBe(
      counterBefore.lastIssuedNumber + 2,
    );

    const auditLogs = await prisma.auditLog.findMany({
      where: {
        entity: 'Batch',
        entityId: { in: [batchIdA, batchIdB] },
        action: AuditAction.UPDATE,
      },
    });
    expect(auditLogs).toHaveLength(2);
  });

  it('rollback tardif : une erreur survenant juste après l’AuditLog restaure exactement Batch et compteur, sans AuditLog résiduel', async () => {
    const batchId = await createLaunchableBatch(siteA);
    const counterBefore = await prisma.lotNumberCounter.findUniqueOrThrow({
      where: { siteId: siteA.siteId },
    });

    const originalRecord = auditLogService.record.bind(auditLogService);
    const recordSpy = jest
      .spyOn(auditLogService, 'record')
      .mockImplementation(async (params, tx) => {
        // Écriture réelle de l'AuditLog (via le même tx, comme en production),
        // PUIS erreur artificielle : le rollback doit donc annuler une écriture
        // effective (Batch + compteur + AuditLog), pas simplement empêcher une
        // écriture qui n'aurait jamais eu lieu.
        const created = await originalRecord(params, tx);
        void created;
        throw new Error(
          'Erreur artificielle pour forcer le rollback tardif (après AuditLog)',
        );
      });

    try {
      await expect(
        service.advance(siteA.siteId, batchId, siteA.userId),
      ).rejects.toThrow(
        'Erreur artificielle pour forcer le rollback tardif (après AuditLog)',
      );
    } finally {
      recordSpy.mockRestore();
    }

    const batchAfterRollback = await prisma.batch.findUniqueOrThrow({
      where: { id: batchId },
    });
    expect(batchAfterRollback.status).toBe(BatchStatus.PLANIFIE);
    expect(batchAfterRollback.currentStep).toBeNull();
    expect(batchAfterRollback.reservedLotNumber).toBeNull();
    expect(batchAfterRollback.reservedExpiryDate).toBeNull();
    expect(batchAfterRollback.startedAt).toBeNull();

    const counterAfterRollback = await prisma.lotNumberCounter.findUniqueOrThrow(
      { where: { siteId: siteA.siteId } },
    );
    expect(counterAfterRollback.lastIssuedNumber).toBe(
      counterBefore.lastIssuedNumber,
    );
    expect(counterAfterRollback.lastIssuedBatchId).toBe(
      counterBefore.lastIssuedBatchId,
    );
    expect(counterAfterRollback.lastIssuedAvailableForReuse).toBe(
      counterBefore.lastIssuedAvailableForReuse,
    );

    const auditLogs = await prisma.auditLog.findMany({
      where: { entity: 'Batch', entityId: batchId },
    });
    expect(auditLogs).toHaveLength(0);
  });

  it('second advance() après un premier succès : ne consomme jamais de nouveau numéro (idempotence du contrat existant : progression d’étape, pas un second lancement)', async () => {
    const batchId = await createLaunchableBatch(siteA);
    const counterBeforeFirst = await prisma.lotNumberCounter.findUniqueOrThrow(
      { where: { siteId: siteA.siteId } },
    );

    const firstResult = await service.advance(
      siteA.siteId,
      batchId,
      siteA.userId,
    );
    const counterAfterFirst = await prisma.lotNumberCounter.findUniqueOrThrow({
      where: { siteId: siteA.siteId },
    });
    expect(counterAfterFirst.lastIssuedNumber).toBe(
      counterBeforeFirst.lastIssuedNumber + 1,
    );

    // `currentStep` n'est plus `null` après le premier succès : le contrat existant
    // (inchangé par cet ADR) route désormais vers la progression d'étape normale
    // (PREPARATION → MELANGE), jamais vers une nouvelle tentative de lancement — la
    // revalidation « déjà lancé » ne s'applique qu'à une ré-entrée concurrente dans le
    // lancement lui-même (voir test de concurrence ci-dessus), pas à un second appel
    // séquentiel une fois `currentStep` déjà renseigné.
    const secondResult = await service.advance(
      siteA.siteId,
      batchId,
      siteA.userId,
    );
    expect(secondResult.currentStep).toBe(BatchStep.MELANGE);

    const counterAfterSecond = await prisma.lotNumberCounter.findUniqueOrThrow(
      { where: { siteId: siteA.siteId } },
    );
    expect(counterAfterSecond.lastIssuedNumber).toBe(
      counterAfterFirst.lastIssuedNumber,
    );

    const finalBatch = await prisma.batch.findUniqueOrThrow({
      where: { id: batchId },
    });
    expect(finalBatch.reservedLotNumber).toBe(firstResult.reservedLotNumber);

    const auditLogs = await prisma.auditLog.findMany({
      where: { entity: 'Batch', entityId: batchId, action: AuditAction.UPDATE },
    });
    expect(auditLogs).toHaveLength(1);
  });

  it('compteur absent pour le site : échoue explicitement, batch reste PLANIFIE, aucune écriture partielle, aucun repli silencieux vers generate()', async () => {
    const batchId = await createLaunchableBatch(siteC);

    await expect(
      service.advance(siteC.siteId, batchId, siteC.userId),
    ).rejects.toThrow(LotNumberCounterNotFoundError);

    const batch = await prisma.batch.findUniqueOrThrow({
      where: { id: batchId },
    });
    expect(batch.status).toBe(BatchStatus.PLANIFIE);
    expect(batch.currentStep).toBeNull();
    // `reservedLotNumber` reste NULL (jamais un repli silencieux vers le préfixe
    // legacy "455XXX" de l'ancien générateur) — la seule autre possibilité aurait été
    // une chaîne commençant par "455", jamais un NULL, en cas de repli non désiré.
    expect(batch.reservedLotNumber).toBeNull();
    expect(batch.reservedExpiryDate).toBeNull();

    const auditLogs = await prisma.auditLog.findMany({
      where: { entity: 'Batch', entityId: batchId },
    });
    expect(auditLogs).toHaveLength(0);

    const counterRows = await prisma.lotNumberCounter.findMany({
      where: { siteId: siteC.siteId },
    });
    expect(counterRows).toHaveLength(0);
  });

  it('CHECK de co-nullabilité : une écriture directe posant reservedLotNumber sans reservedExpiryDate est refusée par PostgreSQL', async () => {
    const batchId = await createLaunchableBatch(siteA);

    await expect(
      prisma.$executeRaw`
        UPDATE batches
        SET reserved_lot_number = '999999'
        WHERE id = ${batchId}
      `,
    ).rejects.toThrow();

    const batch = await prisma.batch.findUniqueOrThrow({
      where: { id: batchId },
    });
    expect(batch.reservedLotNumber).toBeNull();
    expect(batch.reservedExpiryDate).toBeNull();
  });

  it('multi-site : deux sites avec le même compteur de départ attribuent chacun leur propre numéro, sans collision', async () => {
    const counterBeforeA = await prisma.lotNumberCounter.findUniqueOrThrow({
      where: { siteId: siteA.siteId },
    });
    const counterBeforeB = await prisma.lotNumberCounter.findUniqueOrThrow({
      where: { siteId: siteB.siteId },
    });

    const batchIdA = await createLaunchableBatch(siteA);
    const batchIdB = await createLaunchableBatch(siteB);

    const [updatedA, updatedB] = await Promise.all([
      service.advance(siteA.siteId, batchIdA, siteA.userId),
      service.advance(siteB.siteId, batchIdB, siteB.userId),
    ]);

    expect(updatedA.reservedLotNumber).toBe(
      String(counterBeforeA.lastIssuedNumber + 1),
    );
    expect(updatedB.reservedLotNumber).toBe(
      String(counterBeforeB.lastIssuedNumber + 1),
    );

    const finalCounterA = await prisma.lotNumberCounter.findUniqueOrThrow({
      where: { siteId: siteA.siteId },
    });
    const finalCounterB = await prisma.lotNumberCounter.findUniqueOrThrow({
      where: { siteId: siteB.siteId },
    });
    expect(finalCounterA.lastIssuedNumber).toBe(
      counterBeforeA.lastIssuedNumber + 1,
    );
    expect(finalCounterB.lastIssuedNumber).toBe(
      counterBeforeB.lastIssuedNumber + 1,
    );
  });
});
