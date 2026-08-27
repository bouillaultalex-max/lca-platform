import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { BatchStepsService } from '../src/production/batch-steps/batch-steps.service';
import { AuditLogService } from '../src/audit-log/audit-log.service';
import {
  ArticleType,
  AuditAction,
  BatchStatus,
  UserRole,
} from '../generated/prisma/client';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Attend qu'une session PostgreSQL distincte soit réellement bloquée en attente du
 * verrou `FOR UPDATE` sur `batches` — seule preuve valable d'un chevauchement
 * transactionnel réel (voir ADR 0010 § Plan de tests).
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
 * Preuve contre une vraie base PostgreSQL (voir ADR 0010 § Décisions 8/9/11/13) de
 * l'annulation transactionnelle `BatchStepsService.cancel()` : `PLANIFIE → ANNULE`,
 * `EN_COURS → ANNULE` avec libération conditionnelle du numéro (dernier numéro vs
 * numéro intermédiaire), cas legacy, transitions interdites, concurrence réelle
 * (même Batch et lancement/annulation), rollback tardif, réutilisation complète,
 * multi-site. Appel direct des services (pas de HTTP/supertest), comme
 * `batch-launch.e2e-spec.ts`.
 *
 * Recettes volontairement sans aucune `RecipeLine` : faisabilité trivialement
 * satisfaite, isolant le test du calcul de faisabilité lui-même.
 */
describe('BatchStepsService.cancel — annulation → ANNULE (e2e, PostgreSQL réel)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let batchStepsService: BatchStepsService;
  let auditLogService: AuditLogService;

  let siteA: SiteFixture;
  let siteB: SiteFixture;

  const startingCounterValue = 700000;

  async function setupSite(label: string): Promise<SiteFixture> {
    const site = await prisma.site.create({
      data: { name: `Site e2e batch-cancel ${label}` },
    });

    const product = await prisma.article.create({
      data: {
        siteId: site.id,
        type: ArticleType.PRODUIT_FINI,
        openSiReference: `E2E-BC2-${label}-PRODUIT`,
        name: `Produit fini e2e batch-cancel ${label}`,
        unitOfMeasure: 'unité',
        currentUnitCost: 1,
      },
    });

    const machine = await prisma.machine.create({
      data: {
        siteId: site.id,
        name: `Machine e2e batch-cancel ${label}`,
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
        fullName: `Utilisateur e2e batch-cancel ${label}`,
        email: `e2e-batch-cancel-${label.toLowerCase()}@lca-mes.local`,
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

  async function createPlanifieBatch(
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

  /** Crée un batch et le lance immédiatement (via le service réel) — raccourci pour
   * les scénarios d'annulation qui exigent un batch déjà EN_COURS. */
  async function createLaunchedBatch(site: SiteFixture): Promise<string> {
    const batchId = await createPlanifieBatch(site);
    await batchStepsService.advance(site.siteId, batchId, site.userId);
    return batchId;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    batchStepsService = app.get(BatchStepsService);
    auditLogService = app.get(AuditLogService);

    siteA = await setupSite('A');
    siteB = await setupSite('B');

    await prisma.lotNumberCounter.create({
      data: { siteId: siteA.siteId, lastIssuedNumber: startingCounterValue },
    });
    await prisma.lotNumberCounter.create({
      data: { siteId: siteB.siteId, lastIssuedNumber: startingCounterValue },
    });
  });

  afterAll(async () => {
    if (prisma) {
      const siteIds = [siteA?.siteId, siteB?.siteId].filter(
        (id): id is string => Boolean(id),
      );
      await prisma.auditLog.deleteMany({ where: { entity: 'Batch' } });
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

  it('PLANIFIE → ANNULE : aucun compteur modifié, aucun champ reserved* créé, AuditLog présent', async () => {
    const batchId = await createPlanifieBatch(siteA);
    const counterBefore = await prisma.lotNumberCounter.findUniqueOrThrow({
      where: { siteId: siteA.siteId },
    });

    const cancelled = await batchStepsService.cancel(
      siteA.siteId,
      batchId,
      siteA.userId,
    );

    expect(cancelled.status).toBe(BatchStatus.ANNULE);
    expect(cancelled.reservedLotNumber).toBeNull();
    expect(cancelled.reservedExpiryDate).toBeNull();

    const counterAfter = await prisma.lotNumberCounter.findUniqueOrThrow({
      where: { siteId: siteA.siteId },
    });
    expect(counterAfter).toEqual(counterBefore);

    const auditLogs = await prisma.auditLog.findMany({
      where: { entity: 'Batch', entityId: batchId, action: AuditAction.UPDATE },
    });
    expect(auditLogs).toHaveLength(1);
    const after = auditLogs[0].after as Record<string, unknown>;
    expect(after.status).toBe(BatchStatus.ANNULE);
    expect(after.reservedLotNumber).toBeNull();
    expect(after).not.toHaveProperty('lotNumberReusable');
  });

  it('EN_COURS → ANNULE, dernier numéro émis : libère le numéro, compteur marqué réutilisable, un nouveau lancement le réutilise', async () => {
    const batchId = await createLaunchedBatch(siteA);
    const launchedBatch = await prisma.batch.findUniqueOrThrow({
      where: { id: batchId },
    });
    const issuedNumber = launchedBatch.reservedLotNumber!;

    const cancelled = await batchStepsService.cancel(
      siteA.siteId,
      batchId,
      siteA.userId,
    );

    expect(cancelled.status).toBe(BatchStatus.ANNULE);
    expect(cancelled.reservedLotNumber).toBeNull();
    expect(cancelled.reservedExpiryDate).toBeNull();

    const counterAfterCancel = await prisma.lotNumberCounter.findUniqueOrThrow(
      { where: { siteId: siteA.siteId } },
    );
    expect(counterAfterCancel.lastIssuedNumber).toBe(Number(issuedNumber));
    expect(counterAfterCancel.lastIssuedAvailableForReuse).toBe(true);

    const auditLogs = await prisma.auditLog.findMany({
      where: { entity: 'Batch', entityId: batchId, action: AuditAction.UPDATE },
      orderBy: { createdAt: 'asc' },
    });
    expect(auditLogs).toHaveLength(2); // attribution + annulation
    const cancelAudit = auditLogs[1].after as Record<string, unknown>;
    expect(cancelAudit.lotNumberReusable).toBe(true);

    // Nouveau lancement : doit réutiliser exactement le même numéro, sans consommer
    // un numéro supplémentaire.
    const newBatchId = await createPlanifieBatch(siteA);
    const relaunched = await batchStepsService.advance(
      siteA.siteId,
      newBatchId,
      siteA.userId,
    );
    expect(relaunched.reservedLotNumber).toBe(issuedNumber);

    const finalCounter = await prisma.lotNumberCounter.findUniqueOrThrow({
      where: { siteId: siteA.siteId },
    });
    expect(finalCounter.lastIssuedNumber).toBe(Number(issuedNumber));
    expect(finalCounter.lastIssuedBatchId).toBe(newBatchId);
    expect(finalCounter.lastIssuedAvailableForReuse).toBe(false);
  });

  it('numéro intermédiaire déjà dépassé : jamais réutilisé, le compteur continue depuis le dernier numéro réellement émis', async () => {
    const batchAId = await createLaunchedBatch(siteA);
    const batchA = await prisma.batch.findUniqueOrThrow({
      where: { id: batchAId },
    });
    const numberA = Number(batchA.reservedLotNumber);

    const batchBId = await createLaunchedBatch(siteA);
    const batchB = await prisma.batch.findUniqueOrThrow({
      where: { id: batchBId },
    });
    const numberB = Number(batchB.reservedLotNumber);
    expect(numberB).toBe(numberA + 1);

    // A détient désormais un numéro intermédiaire (B a déjà été émis après lui).
    const cancelledA = await batchStepsService.cancel(
      siteA.siteId,
      batchAId,
      siteA.userId,
    );
    expect(cancelledA.status).toBe(BatchStatus.ANNULE);

    const counterAfterCancelA = await prisma.lotNumberCounter.findUniqueOrThrow(
      { where: { siteId: siteA.siteId } },
    );
    expect(counterAfterCancelA.lastIssuedNumber).toBe(numberB);
    expect(counterAfterCancelA.lastIssuedAvailableForReuse).toBe(false);

    const cancelAuditA = await prisma.auditLog.findMany({
      where: {
        entity: 'Batch',
        entityId: batchAId,
        action: AuditAction.UPDATE,
      },
      orderBy: { createdAt: 'asc' },
    });
    const cancelAAfter = cancelAuditA[cancelAuditA.length - 1]
      .after as Record<string, unknown>;
    expect(cancelAAfter.lotNumberReusable).toBe(false);

    // Nouveau lancement : doit recevoir numberB + 1, jamais numberA.
    const batchCId = await createPlanifieBatch(siteA);
    const launchedC = await batchStepsService.advance(
      siteA.siteId,
      batchCId,
      siteA.userId,
    );
    expect(Number(launchedC.reservedLotNumber)).toBe(numberB + 1);
    expect(launchedC.reservedLotNumber).not.toBe(String(numberA));

    const finalCounter = await prisma.lotNumberCounter.findUniqueOrThrow({
      where: { siteId: siteA.siteId },
    });
    expect(finalCounter.lastIssuedNumber).toBe(numberB + 1);
    expect(finalCounter.lastIssuedBatchId).toBe(batchCId);
  });

  it('cas legacy (EN_COURS avec reservedLotNumber/reservedExpiryDate NULL) : annulation autorisée sans aucun accès au compteur', async () => {
    const batchId = await createPlanifieBatch(siteA);
    // Simule un batch antérieur au déploiement du nouveau mécanisme : passé EN_COURS
    // directement en base, jamais via BatchStepsService.advance (§ Décision 14).
    await prisma.batch.update({
      where: { id: batchId },
      data: { status: BatchStatus.EN_COURS, currentStep: 'PREPARATION' },
    });
    const counterBefore = await prisma.lotNumberCounter.findUniqueOrThrow({
      where: { siteId: siteA.siteId },
    });

    const cancelled = await batchStepsService.cancel(
      siteA.siteId,
      batchId,
      siteA.userId,
    );

    expect(cancelled.status).toBe(BatchStatus.ANNULE);

    const counterAfter = await prisma.lotNumberCounter.findUniqueOrThrow({
      where: { siteId: siteA.siteId },
    });
    expect(counterAfter).toEqual(counterBefore);
  });

  it.each([BatchStatus.ANNULE, BatchStatus.TERMINE])(
    'refuse explicitement la transition depuis %s, sans toucher au compteur ni créer d’AuditLog de transition',
    async (status) => {
      const batchId = await createPlanifieBatch(siteA);
      await prisma.batch.update({ where: { id: batchId }, data: { status } });
      const counterBefore = await prisma.lotNumberCounter.findUniqueOrThrow({
        where: { siteId: siteA.siteId },
      });

      await expect(
        batchStepsService.cancel(siteA.siteId, batchId, siteA.userId),
      ).rejects.toThrow();

      const counterAfter = await prisma.lotNumberCounter.findUniqueOrThrow({
        where: { siteId: siteA.siteId },
      });
      expect(counterAfter).toEqual(counterBefore);

      const batchAfter = await prisma.batch.findUniqueOrThrow({
        where: { id: batchId },
      });
      expect(batchAfter.status).toBe(status);

      const auditLogs = await prisma.auditLog.findMany({
        where: { entity: 'Batch', entityId: batchId },
      });
      expect(auditLogs).toHaveLength(0);
    },
  );

  it(
    'deux annulations concurrentes du MÊME Batch EN_COURS : une seule réussit, aucun double accès au compteur ' +
      '(chevauchement prouvé via pg_stat_activity)',
    async () => {
      const batchId = await createLaunchedBatch(siteA);
      const launchedBatch = await prisma.batch.findUniqueOrThrow({
        where: { id: batchId },
      });
      const issuedNumber = launchedBatch.reservedLotNumber!;

      // `cancel()` a une section critique bien plus courte que `launch()` (pas de
      // vérification de faisabilité, un seul aller-retour de libération) : sur une
      // base PostgreSQL locale, l'intégralité de la transaction s'exécute en moins
      // d'une milliseconde, sous le seuil observable par un sondage passif de
      // `pg_stat_activity` (vérifié empiriquement : aucune requête n'apparaît jamais
      // "active" entre deux sondages, même à 1 ms d'intervalle). Pour prouver
      // réellement le chevauchement sans modifier le code de production, on retient
      // artificiellement ouverte — via `jest.spyOn` sur le collaborateur réel
      // `AuditLogService.record` (appelé juste avant le COMMIT, une fois toutes les
      // écritures réelles déjà effectuées) — la PREMIÈRE des deux transactions à
      // l'atteindre, le temps de confirmer que la seconde est bien bloquée sur le
      // verrou `Batch`. Même principe que le test de rollback tardif ci-dessous :
      // un espionnage d'un collaborateur réel, jamais un hook ajouté en production.
      let firstCallSeen = false;
      const gate = (() => {
        let resolve!: () => void;
        const promise = new Promise<void>((res) => {
          resolve = res;
        });
        return { promise, resolve };
      })();
      const originalRecord = auditLogService.record.bind(auditLogService);
      const recordSpy = jest
        .spyOn(auditLogService, 'record')
        .mockImplementation(async (params, tx) => {
          const isFirstToArrive = !firstCallSeen;
          firstCallSeen = true;
          const created = await originalRecord(params, tx);
          if (isFirstToArrive) {
            await gate.promise;
          }
          return created;
        });

      const resultsPromise = Promise.allSettled([
        batchStepsService.cancel(siteA.siteId, batchId, siteA.userId),
        batchStepsService.cancel(siteA.siteId, batchId, siteA.userId),
      ]);

      const contested = await waitUntilBatchLockContested(prisma);
      gate.resolve();
      const [r1, r2] = await resultsPromise;
      recordSpy.mockRestore();

      expect(contested).toBe(true);

      const outcomes = [r1, r2];
      const successCount = outcomes.filter(
        (r) => r.status === 'fulfilled',
      ).length;
      expect(successCount).toBe(1);

      const finalBatch = await prisma.batch.findUniqueOrThrow({
        where: { id: batchId },
      });
      expect(finalBatch.status).toBe(BatchStatus.ANNULE);
      expect(finalBatch.reservedLotNumber).toBeNull();

      const finalCounter = await prisma.lotNumberCounter.findUniqueOrThrow({
        where: { siteId: siteA.siteId },
      });
      expect(finalCounter.lastIssuedNumber).toBe(Number(issuedNumber));
      expect(finalCounter.lastIssuedAvailableForReuse).toBe(true);

      const auditLogs = await prisma.auditLog.findMany({
        where: {
          entity: 'Batch',
          entityId: batchId,
          action: AuditAction.UPDATE,
        },
      });
      // Une entrée pour l'attribution (lancement) + une seule pour l'annulation.
      expect(auditLogs).toHaveLength(2);
    },
    15000,
  );

  it(
    'concurrence lancement/annulation sur un même Batch PLANIFIE : résultat déterministe et cohérent quel que soit l’ordre',
    async () => {
      const batchId = await createPlanifieBatch(siteA);

      // `cancel()` sur un batch encore PLANIFIE est particulièrement rapide (aucun
      // accès au compteur, § Décision 11) : comme pour le test de concurrence
      // ci-dessus, la fenêtre réelle est parfois trop courte pour être observée par
      // un sondage passif de `pg_stat_activity` selon lequel des deux appels gagne la
      // course. Même technique : retenir artificiellement, via `jest.spyOn` sur le
      // collaborateur réel `AuditLogService.record`, celui des deux qui l'atteint en
      // premier (quel qu'il soit), le temps de confirmer que l'autre est bien bloqué
      // sur le verrou `Batch`.
      let firstCallSeen = false;
      const gate = (() => {
        let resolve!: () => void;
        const promise = new Promise<void>((res) => {
          resolve = res;
        });
        return { promise, resolve };
      })();
      const originalRecord = auditLogService.record.bind(auditLogService);
      const recordSpy = jest
        .spyOn(auditLogService, 'record')
        .mockImplementation(async (params, tx) => {
          const isFirstToArrive = !firstCallSeen;
          firstCallSeen = true;
          const created = await originalRecord(params, tx);
          if (isFirstToArrive) {
            await gate.promise;
          }
          return created;
        });

      const resultsPromise = Promise.allSettled([
        batchStepsService.advance(siteA.siteId, batchId, siteA.userId),
        batchStepsService.cancel(siteA.siteId, batchId, siteA.userId),
      ]);

      const contested = await waitUntilBatchLockContested(prisma);
      gate.resolve();
      await resultsPromise;
      recordSpy.mockRestore();

      expect(contested).toBe(true);

      const finalBatch = await prisma.batch.findUniqueOrThrow({
        where: { id: batchId },
      });
      const finalCounter = await prisma.lotNumberCounter.findUniqueOrThrow({
        where: { siteId: siteA.siteId },
      });

      // Invariants obligatoires (ADR 0010 § Décision 10/11), quel que soit l'ordre
      // réel de résolution du verrou :
      if (finalBatch.status === BatchStatus.EN_COURS) {
        expect(finalBatch.reservedLotNumber).not.toBeNull();
        expect(finalBatch.reservedExpiryDate).not.toBeNull();
        expect(finalCounter.lastIssuedAvailableForReuse).toBe(false);
      } else {
        expect(finalBatch.status).toBe(BatchStatus.ANNULE);
        expect(finalBatch.reservedLotNumber).toBeNull();
        expect(finalBatch.reservedExpiryDate).toBeNull();
      }
    },
    15000,
  );

  it('rollback tardif — libération : une erreur survenant juste après l’AuditLog restaure exactement Batch et compteur, aucun AuditLog d’annulation résiduel', async () => {
    const batchId = await createLaunchedBatch(siteA);
    const batchBefore = await prisma.batch.findUniqueOrThrow({
      where: { id: batchId },
    });
    const counterBefore = await prisma.lotNumberCounter.findUniqueOrThrow({
      where: { siteId: siteA.siteId },
    });
    const auditCountBefore = await prisma.auditLog.count({
      where: { entity: 'Batch', entityId: batchId },
    });

    const originalRecord = auditLogService.record.bind(auditLogService);
    const recordSpy = jest
      .spyOn(auditLogService, 'record')
      .mockImplementation(async (params, tx) => {
        const created = await originalRecord(params, tx);
        void created;
        throw new Error(
          'Erreur artificielle pour forcer le rollback tardif (libération, après AuditLog)',
        );
      });

    try {
      await expect(
        batchStepsService.cancel(siteA.siteId, batchId, siteA.userId),
      ).rejects.toThrow(
        'Erreur artificielle pour forcer le rollback tardif (libération, après AuditLog)',
      );
    } finally {
      recordSpy.mockRestore();
    }

    const batchAfterRollback = await prisma.batch.findUniqueOrThrow({
      where: { id: batchId },
    });
    expect(batchAfterRollback.status).toBe(BatchStatus.EN_COURS);
    expect(batchAfterRollback.reservedLotNumber).toBe(
      batchBefore.reservedLotNumber,
    );
    expect(batchAfterRollback.reservedExpiryDate).toEqual(
      batchBefore.reservedExpiryDate,
    );

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

    const auditCountAfter = await prisma.auditLog.count({
      where: { entity: 'Batch', entityId: batchId },
    });
    expect(auditCountAfter).toBe(auditCountBefore);
  });

  it('scénario complet de réutilisation : amorce N → lance A (N) → annule A → lance B → B reçoit N, aucun Lot créé', async () => {
    const batchAId = await createLaunchedBatch(siteA);
    const batchA = await prisma.batch.findUniqueOrThrow({
      where: { id: batchAId },
    });
    const n = batchA.reservedLotNumber!;

    await batchStepsService.cancel(siteA.siteId, batchAId, siteA.userId);

    const counterAfterCancel = await prisma.lotNumberCounter.findUniqueOrThrow(
      { where: { siteId: siteA.siteId } },
    );
    expect(counterAfterCancel.lastIssuedAvailableForReuse).toBe(true);

    const batchBId = await createPlanifieBatch(siteA);
    const batchB = await batchStepsService.advance(
      siteA.siteId,
      batchBId,
      siteA.userId,
    );

    const finalBatchA = await prisma.batch.findUniqueOrThrow({
      where: { id: batchAId },
    });
    expect(finalBatchA.status).toBe(BatchStatus.ANNULE);
    expect(finalBatchA.reservedLotNumber).toBeNull();
    expect(finalBatchA.reservedExpiryDate).toBeNull();

    expect(batchB.status).toBe(BatchStatus.EN_COURS);
    expect(batchB.reservedLotNumber).toBe(n);

    const finalCounter = await prisma.lotNumberCounter.findUniqueOrThrow({
      where: { siteId: siteA.siteId },
    });
    expect(finalCounter.lastIssuedNumber).toBe(Number(n));
    expect(finalCounter.lastIssuedBatchId).toBe(batchBId);
    expect(finalCounter.lastIssuedAvailableForReuse).toBe(false);

    const lots = await prisma.lot.findMany({
      where: { batchId: { in: [batchAId, batchBId] } },
    });
    expect(lots).toHaveLength(0);
  });

  it('multi-site : une annulation sur le site A ne modifie jamais le compteur du site B', async () => {
    const batchAId = await createLaunchedBatch(siteA);
    const batchBId = await createLaunchedBatch(siteB);
    const counterBBefore = await prisma.lotNumberCounter.findUniqueOrThrow({
      where: { siteId: siteB.siteId },
    });

    await batchStepsService.cancel(siteA.siteId, batchAId, siteA.userId);

    const counterBAfter = await prisma.lotNumberCounter.findUniqueOrThrow({
      where: { siteId: siteB.siteId },
    });
    expect(counterBAfter).toEqual(counterBBefore);

    const batchB = await prisma.batch.findUniqueOrThrow({
      where: { id: batchBId },
    });
    expect(batchB.status).toBe(BatchStatus.EN_COURS);
  });
});
