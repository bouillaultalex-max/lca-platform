import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import * as bcrypt from 'bcryptjs';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditLogService } from '../src/audit-log/audit-log.service';
import {
  ArticleType,
  BatchStatus,
  BatchStep,
  RecipeStatus,
  UserRole,
} from '../generated/prisma/client';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Attend qu'une session PostgreSQL distincte soit réellement bloquée en attente du
 * verrou `FOR UPDATE` sur `batches` — seule preuve valable d'un chevauchement
 * transactionnel réel (voir ADR 0010 § Plan de tests, même technique que
 * `test/batch-cancel.e2e-spec.ts`) : un `Promise.all()` seul ne le prouve jamais.
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

interface LoginResponseBody {
  accessToken: string;
}

interface AllocationResponseBody {
  id: string;
  productId: string;
}

interface LotResponseBody {
  id: string;
  lotNumber: string;
  quantity: number;
  allocationId: string | null;
  batchId: string;
  expiryDate: string | null;
}

interface BatchClosureResponseBody {
  batch: { id: string; status: BatchStatus };
  lots: LotResponseBody[];
  lot: LotResponseBody;
}

/**
 * ADR 0010, étape 5 : `BatchClosureService.close()` doit réutiliser strictement
 * `batch.reservedLotNumber`/`reservedExpiryDate` attribués au lancement (§ Décision
 * 3/12), jamais consommer un second numéro, et ne conserver le repli `generate()`
 * (§ Décision 14) que pour un batch `EN_COURS` legacy sans réservation.
 *
 * Site dédié et isolé (jamais le site partagé « Site de test e2e » utilisé par
 * `batch-closure.e2e-spec.ts` et de nombreux autres fichiers e2e) : les assertions
 * ci-dessous portent sur des valeurs *exactes* de compteur (N, N+1, N+2...), qui
 * seraient rendues non déterministes par un compteur partagé entre suites Jest
 * exécutées en parallèle (même précaution que `test/batch-cancel.e2e-spec.ts`).
 */
describe('BatchClosure — réutilisation du numéro/DDM réservés au lancement (ADR 0010, étape 5)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let auditLogService: AuditLogService;
  let token: string;
  let siteId: string;
  let userId: string;

  let materialArticleId: string;
  let packagingArticleId: string;
  let packagingSecondArticleId: string;
  let finishedProductId: string;
  let finishedProductSecondId: string;
  let recipeId: string;
  let machineId: string;

  const createdBatchIds: string[] = [];

  const password = 'MotDePasseTest123!';
  const email = 'e2e-batch-closure-numbering@lca-mes.local';
  const startingCounterValue = 800000;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    prisma = app.get(PrismaService);
    auditLogService = app.get(AuditLogService);

    const site = await prisma.site.create({
      data: { name: 'Site e2e batch-closure-numbering' },
    });
    siteId = site.id;

    await prisma.lotNumberCounter.create({
      data: { siteId, lastIssuedNumber: startingCounterValue },
    });

    const passwordHash = await bcrypt.hash(password, 4);
    const user = await prisma.user.create({
      data: {
        siteId,
        fullName: 'Utilisateur Test E2E (clôture — numérotation)',
        email,
        passwordHash,
        role: UserRole.RESPONSABLE_LABORATOIRE,
      },
    });
    userId = user.id;

    const loginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password });
    token = (loginResponse.body as LoginResponseBody).accessToken;

    const materialArticle = await prisma.article.create({
      data: {
        siteId,
        type: ArticleType.MATIERE_PREMIERE,
        openSiReference: 'E2E-BCN-MP',
        name: 'Matière première e2e (clôture — numérotation)',
        unitOfMeasure: 'L',
        currentUnitCost: 1,
      },
    });
    materialArticleId = materialArticle.id;

    const packagingArticle = await prisma.article.create({
      data: {
        siteId,
        type: ArticleType.PACKAGING,
        openSiReference: 'E2E-BCN-PKG',
        name: 'Packaging e2e (clôture — numérotation)',
        unitOfMeasure: 'unité',
        currentUnitCost: 1,
      },
    });
    packagingArticleId = packagingArticle.id;

    const packagingSecond = await prisma.article.create({
      data: {
        siteId,
        type: ArticleType.PACKAGING,
        openSiReference: 'E2E-BCN-PKG-2',
        name: 'Packaging 2 e2e (clôture — numérotation)',
        unitOfMeasure: 'unité',
        currentUnitCost: 1,
      },
    });
    packagingSecondArticleId = packagingSecond.id;

    const finishedProduct = await prisma.article.create({
      data: {
        siteId,
        type: ArticleType.PRODUIT_FINI,
        openSiReference: 'E2E-BCN-PF',
        name: 'Produit fini e2e (clôture — numérotation)',
        unitOfMeasure: 'unité',
        currentUnitCost: 1,
      },
    });
    finishedProductId = finishedProduct.id;

    const finishedProductSecond = await prisma.article.create({
      data: {
        siteId,
        type: ArticleType.PRODUIT_FINI,
        openSiReference: 'E2E-BCN-PF-2',
        name: 'Produit fini 2 e2e (clôture — numérotation)',
        unitOfMeasure: 'unité',
        currentUnitCost: 1,
      },
    });
    finishedProductSecondId = finishedProductSecond.id;

    const machine = await prisma.machine.create({
      data: {
        siteId,
        name: 'Machine e2e (clôture — numérotation)',
        supportedFormats: [100],
        active: true,
      },
    });
    machineId = machine.id;

    const recipe = await prisma.recipe.create({
      data: {
        siteId,
        finishedProductId,
        format: 100,
        version: 1,
        status: RecipeStatus.ACTIVE,
        lines: {
          create: [
            { articleId: materialArticleId, quantityPerUnit: 100, unit: '%' },
            {
              articleId: packagingArticleId,
              quantityPerUnit: 1,
              unit: 'unité',
            },
          ],
        },
      },
    });
    recipeId = recipe.id;

    // Recette compatible (même format, même matière première) mais packaging
    // distinct — utilisée uniquement pour la seconde allocation du test
    // multi-allocation ci-dessous.
    await prisma.recipe.create({
      data: {
        siteId,
        finishedProductId: finishedProductSecondId,
        format: 100,
        version: 1,
        status: RecipeStatus.ACTIVE,
        lines: {
          create: [
            { articleId: materialArticleId, quantityPerUnit: 100, unit: '%' },
            {
              articleId: packagingSecondArticleId,
              quantityPerUnit: 1,
              unit: 'unité',
            },
          ],
        },
      },
    });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.auditLog.deleteMany({
        where: { entity: 'Batch', entityId: { in: createdBatchIds } },
      });
      await prisma.lotGenealogy.deleteMany({
        where: { lot: { batchId: { in: createdBatchIds } } },
      });
      await prisma.batchCost.deleteMany({
        where: { lot: { batchId: { in: createdBatchIds } } },
      });
      await prisma.lot.deleteMany({
        where: { batchId: { in: createdBatchIds } },
      });
      await prisma.stockMovement.deleteMany({ where: { siteId } });
      await prisma.batchProductAllocation.deleteMany({
        where: { batchId: { in: createdBatchIds } },
      });
      await prisma.batch.deleteMany({
        where: { id: { in: createdBatchIds } },
      });
      await prisma.lotNumberCounter.deleteMany({ where: { siteId } });
      await prisma.recipeLine.deleteMany({ where: { recipe: { siteId } } });
      await prisma.recipe.deleteMany({ where: { siteId } });
      await prisma.machine.deleteMany({ where: { siteId } });
      await prisma.stockItem.deleteMany({ where: { siteId } });
      await prisma.stockLot.deleteMany({ where: { siteId } });
      await prisma.article.deleteMany({ where: { siteId } });
      await prisma.user.deleteMany({ where: { siteId } });
      await prisma.site.deleteMany({ where: { id: siteId } });
    }
    if (app) {
      await app.close();
    }
  });

  async function provisionStock(
    articleId: string,
    quantity: number,
  ): Promise<void> {
    await prisma.stockLot.create({
      data: {
        siteId,
        articleId,
        supplierLotNumber: `E2E-BCN-LOT-${articleId}-${Date.now()}-${Math.random()}`,
        receivedQuantity: quantity,
        remainingQuantity: quantity,
        receivedAt: new Date(),
      },
    });
    await prisma.stockItem.upsert({
      where: { articleId },
      update: { availableQuantity: { increment: quantity } },
      create: { siteId, articleId, availableQuantity: quantity },
    });
  }

  async function createBatch(
    recipeIdToUse: string,
    plannedQuantity: number,
  ): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/batching/batches')
      .set('Authorization', `Bearer ${token}`)
      .send({ recipeId: recipeIdToUse, machineId, plannedQuantity })
      .expect(201);
    const id = (response.body as { id: string }).id;
    createdBatchIds.push(id);
    return id;
  }

  async function createLegacyBatch(plannedQuantity: number): Promise<string> {
    const batch = await prisma.batch.create({
      data: {
        siteId,
        recipeId,
        machineId,
        format: 100,
        plannedQuantity,
        status: BatchStatus.EN_COURS,
        currentStep: BatchStep.CONDITIONNEMENT,
        createdByUserId: userId,
      },
    });
    createdBatchIds.push(batch.id);
    return batch.id;
  }

  /** Un seul `advance-step` : lance le batch (`PLANIFIE → EN_COURS`, ADR 0010 §
   * Décision 10) sans le faire progresser jusqu'à `CONDITIONNEMENT`. */
  async function launchOnly(batchId: string): Promise<void> {
    await request(app.getHttpServer())
      .post(`/production/batches/${batchId}/advance-step`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  }

  async function advanceToConditionnement(batchId: string): Promise<void> {
    for (let i = 0; i < 4; i += 1) {
      await request(app.getHttpServer())
        .post(`/production/batches/${batchId}/advance-step`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    }
  }

  async function cancelBatch(batchId: string): Promise<void> {
    await request(app.getHttpServer())
      .post(`/production/batches/${batchId}/cancel`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  }

  async function closeBatch(
    batchId: string,
    payload: Record<string, unknown>,
  ): Promise<BatchClosureResponseBody> {
    const response = await request(app.getHttpServer())
      .post(`/production/batches/${batchId}/close`)
      .set('Authorization', `Bearer ${token}`)
      .send(payload)
      .expect(200);
    return response.body as BatchClosureResponseBody;
  }

  async function getCounter(): Promise<number> {
    const counter = await prisma.lotNumberCounter.findUniqueOrThrow({
      where: { siteId },
    });
    return counter.lastIssuedNumber;
  }

  async function getBatch(batchId: string) {
    return prisma.batch.findUniqueOrThrow({ where: { id: batchId } });
  }

  it('réutilise reservedLotNumber/reservedExpiryDate à la clôture, sans jamais consommer un second numéro', async () => {
    await provisionStock(materialArticleId, 100);
    await provisionStock(packagingArticleId, 1000);

    const counterBefore = await getCounter();
    const batchAId = await createBatch(recipeId, 500);
    await advanceToConditionnement(batchAId);
    const batchAfterLaunch = await getBatch(batchAId);
    expect(batchAfterLaunch.reservedLotNumber).toBe(String(counterBefore + 1));
    expect(batchAfterLaunch.reservedExpiryDate).not.toBeNull();

    const body = await closeBatch(batchAId, {
      endedAt: '2026-07-06T16:00:00.000Z',
      producedQuantity: 480,
      rejectedQuantity: 20,
    });

    expect(body.lots[0].lotNumber).toBe(batchAfterLaunch.reservedLotNumber);
    expect(new Date(body.lots[0].expiryDate!)).toEqual(
      batchAfterLaunch.reservedExpiryDate,
    );

    // Aucune double consommation (ADR 0010 § Plan de tests, "aucune double
    // consommation") : le compteur n'a pas bougé pendant la clôture.
    expect(await getCounter()).toBe(counterBefore + 1);

    // Un nouveau lancement reçoit counterBefore + 2, jamais + 3 : la clôture de A
    // n'a consommé aucun numéro supplémentaire.
    const batchBId = await createBatch(recipeId, 100);
    await launchOnly(batchBId);
    const batchB = await getBatch(batchBId);
    expect(batchB.reservedLotNumber).toBe(String(counterBefore + 2));
  });

  it('ignore dto.expiryDate pour un batch nominal (DDM figée au lancement, jamais recalculée)', async () => {
    await provisionStock(materialArticleId, 100);
    await provisionStock(packagingArticleId, 1000);

    const batchId = await createBatch(recipeId, 50);
    await advanceToConditionnement(batchId);
    const launchedBatch = await getBatch(batchId);

    const body = await closeBatch(batchId, {
      endedAt: '2026-07-06T16:00:00.000Z',
      producedQuantity: 45,
      rejectedQuantity: 5,
      expiryDate: '2099-01-01',
    });

    expect(new Date(body.lots[0].expiryDate!)).toEqual(
      launchedBatch.reservedExpiryDate,
    );
    expect(body.lots[0].expiryDate).not.toBe('2099-01-01T00:00:00.000Z');
  });

  it('batch multi-allocation nominal : tous les Lots partagent le même lotNumber réservé, avec des id distincts', async () => {
    await provisionStock(materialArticleId, 100);
    await provisionStock(packagingArticleId, 200);
    await provisionStock(packagingSecondArticleId, 200);

    const batchId = await createBatch(recipeId, 100);
    const addResponse = await request(app.getHttpServer())
      .post(`/batching/batches/${batchId}/allocations`)
      .set('Authorization', `Bearer ${token}`)
      .send({ productId: finishedProductSecondId, plannedQuantity: 50 })
      .expect(201);
    const allocationSecondId = (addResponse.body as AllocationResponseBody).id;

    const allocationRefId = await (async () => {
      const listResponse = await request(app.getHttpServer())
        .get(`/batching/batches/${batchId}/allocations`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      return (listResponse.body as AllocationResponseBody[]).find(
        (allocation) => allocation.productId === finishedProductId,
      )!.id;
    })();

    await advanceToConditionnement(batchId);
    const launchedBatch = await getBatch(batchId);

    const body = await closeBatch(batchId, {
      endedAt: '2026-07-06T16:00:00.000Z',
      allocations: [
        { allocationId: allocationRefId, producedQuantity: 95, rejectedQuantity: 5 },
        {
          allocationId: allocationSecondId,
          producedQuantity: 48,
          rejectedQuantity: 2,
        },
      ],
    });

    expect(body.lots).toHaveLength(2);
    expect(body.lots[0].lotNumber).toBe(launchedBatch.reservedLotNumber);
    expect(body.lots[1].lotNumber).toBe(launchedBatch.reservedLotNumber);
    expect(body.lots[0].id).not.toBe(body.lots[1].id);
  });

  it('repli legacy (batch EN_COURS sans réservation) : appelle generate(), journalise un AuditLog legacyFallbackUsed, ne touche jamais LotNumberCounter', async () => {
    await provisionStock(materialArticleId, 100);
    await provisionStock(packagingArticleId, 1000);
    const counterBefore = await getCounter();

    const legacyBatchId = await createLegacyBatch(500);

    const body = await closeBatch(legacyBatchId, {
      producedQuantity: 480,
      rejectedQuantity: 20,
      endedAt: '2026-07-06T16:00:00.000Z',
    });

    // Ancien format legacy (455XXX, voir LotNumberGeneratorService.generate) —
    // jamais un numéro dérivé de LotNumberCounter.
    expect(body.lots[0].lotNumber).toMatch(/^455\d{3}$/);

    expect(await getCounter()).toBe(counterBefore);

    const auditLogs = await prisma.auditLog.findMany({
      where: { entity: 'Batch', entityId: legacyBatchId },
    });
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0].after).toEqual({ legacyFallbackUsed: true });
  });

  it('rollback tardif du repli legacy : aucune trace (Lot, AuditLog, statut Batch) ne subsiste si la transaction échoue après l’écriture de l’AuditLog', async () => {
    await provisionStock(materialArticleId, 100);
    await provisionStock(packagingArticleId, 1000);

    const legacyBatchId = await createLegacyBatch(500);

    const originalRecord = auditLogService.record.bind(auditLogService);
    const recordSpy = jest
      .spyOn(auditLogService, 'record')
      .mockImplementation(async (params, tx) => {
        const created = await originalRecord(params, tx);
        throw new Error(
          'panne simulée après écriture AuditLog (preuve de rollback tardif)',
        );
      });

    await request(app.getHttpServer())
      .post(`/production/batches/${legacyBatchId}/close`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        producedQuantity: 480,
        rejectedQuantity: 20,
        endedAt: '2026-07-06T16:00:00.000Z',
      })
      .expect(500);

    recordSpy.mockRestore();

    const finalBatch = await getBatch(legacyBatchId);
    expect(finalBatch.status).toBe(BatchStatus.EN_COURS);

    const lots = await prisma.lot.findMany({
      where: { batchId: legacyBatchId },
    });
    expect(lots).toHaveLength(0);

    const auditLogs = await prisma.auditLog.findMany({
      where: { entity: 'Batch', entityId: legacyBatchId },
    });
    expect(auditLogs).toHaveLength(0);
  });

  it('scénario complet de réutilisation après annulation : A→N, annulation (libère N), B→N (réutilisation), clôture de B utilise N sans consommer N+1', async () => {
    await provisionStock(materialArticleId, 100);
    await provisionStock(packagingArticleId, 1000);

    const counterBefore = await getCounter();
    const batchAId = await createBatch(recipeId, 50);
    await launchOnly(batchAId);
    const batchA = await getBatch(batchAId);
    expect(batchA.reservedLotNumber).toBe(String(counterBefore + 1));

    await cancelBatch(batchAId);
    expect(await getCounter()).toBe(counterBefore + 1); // inchangé, mais réutilisable

    const batchBId = await createBatch(recipeId, 50);
    await advanceToConditionnement(batchBId);
    const batchB = await getBatch(batchBId);
    expect(batchB.reservedLotNumber).toBe(String(counterBefore + 1)); // réutilisé, jamais +2

    const body = await closeBatch(batchBId, {
      endedAt: '2026-07-06T16:00:00.000Z',
      producedQuantity: 45,
      rejectedQuantity: 5,
    });
    expect(body.lots[0].lotNumber).toBe(String(counterBefore + 1));
    expect(await getCounter()).toBe(counterBefore + 1); // toujours inchangé après la clôture

    const batchCId = await createBatch(recipeId, 10);
    await launchOnly(batchCId);
    const batchC = await getBatch(batchCId);
    expect(batchC.reservedLotNumber).toBe(String(counterBefore + 2)); // jamais N à nouveau
  });

  it('scénario numéro intermédiaire jamais réutilisé : A→N, B→N+1, annulation de A (N perdu), clôture de B utilise N+1, C→N+2', async () => {
    await provisionStock(materialArticleId, 100);
    await provisionStock(packagingArticleId, 1000);

    const counterBefore = await getCounter();
    const batchAId = await createBatch(recipeId, 10);
    await launchOnly(batchAId); // A → N (counterBefore + 1)

    const batchBId = await createBatch(recipeId, 50);
    await advanceToConditionnement(batchBId); // B → N+1 (counterBefore + 2)
    const batchB = await getBatch(batchBId);
    expect(batchB.reservedLotNumber).toBe(String(counterBefore + 2));

    await cancelBatch(batchAId); // A détenait N, plus le dernier émis → jamais réutilisé

    const body = await closeBatch(batchBId, {
      endedAt: '2026-07-06T16:00:00.000Z',
      producedQuantity: 45,
      rejectedQuantity: 5,
    });
    expect(body.lots[0].lotNumber).toBe(String(counterBefore + 2));

    const batchCId = await createBatch(recipeId, 10);
    await launchOnly(batchCId);
    const batchC = await getBatch(batchCId);
    // Jamais counterBefore + 1 (numéro de A, intermédiaire, perdu définitivement).
    expect(batchC.reservedLotNumber).toBe(String(counterBefore + 3));
  });

  it('deux clôtures concurrentes du MÊME batch (repli legacy) : chevauchement réel prouvé via pg_stat_activity, une seule réussit, aucun doublon de Lot', async () => {
    await provisionStock(materialArticleId, 200);
    await provisionStock(packagingArticleId, 2000);

    const legacyBatchId = await createLegacyBatch(500);

    // Même technique que test/batch-cancel.e2e-spec.ts : espionne le collaborateur
    // réel `AuditLogService.record` (n'est atteint que par le chemin de repli legacy,
    // juste après le verrou Batch et la revalidation, bien avant la fin de la
    // transaction) — la PREMIÈRE des deux transactions à l'atteindre est mise en
    // pause le temps de confirmer que la seconde est réellement bloquée sur le verrou
    // `Batch` (§ Décision 10/14). Un `Promise.all()` seul ne prouverait rien : sur
    // cette machine, la transaction de clôture peut se terminer en moins d'une
    // milliseconde, bien trop vite pour qu'un sondage passif seul observe jamais la
    // contention.
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

    const closeOnce = () =>
      request(app.getHttpServer())
        .post(`/production/batches/${legacyBatchId}/close`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          producedQuantity: 480,
          rejectedQuantity: 20,
          endedAt: '2026-07-06T16:00:00.000Z',
        });

    const resultsPromise = Promise.allSettled([closeOnce(), closeOnce()]);

    const contested = await waitUntilBatchLockContested(prisma);
    gate.resolve();
    const [r1, r2] = await resultsPromise;
    recordSpy.mockRestore();

    expect(contested).toBe(true);

    const statuses = [r1, r2].map((r) =>
      r.status === 'fulfilled' ? r.value.status : null,
    );
    expect(statuses.filter((status) => status === 200)).toHaveLength(1);

    const lots = await prisma.lot.findMany({
      where: { batchId: legacyBatchId },
    });
    expect(lots).toHaveLength(1); // jamais deux séries de Lots pour le même batch

    const finalBatch = await getBatch(legacyBatchId);
    expect(finalBatch.status).toBe(BatchStatus.TERMINE);
  });

  it('rejette explicitement la clôture concurrente au numéro déjà terminé (non-régression : pas de succès silencieux, pas de 500)', async () => {
    await provisionStock(materialArticleId, 100);
    await provisionStock(packagingArticleId, 1000);
    const legacyBatchId = await createLegacyBatch(50);

    await closeBatch(legacyBatchId, {
      producedQuantity: 45,
      rejectedQuantity: 5,
      endedAt: '2026-07-06T16:00:00.000Z',
    });

    await request(app.getHttpServer())
      .post(`/production/batches/${legacyBatchId}/close`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        producedQuantity: 45,
        rejectedQuantity: 5,
        endedAt: '2026-07-06T16:00:00.000Z',
      })
      .expect(400);
  });
});
