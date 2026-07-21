import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import * as bcrypt from 'bcryptjs';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  ArticleType,
  BatchStatus,
  BatchStep,
  RecipeStatus,
  UserRole,
} from '../generated/prisma/client';

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
  batch: {
    id: string;
    status: BatchStatus;
    producedQuantity: number;
    rejectedQuantity: number;
  };
  lots: LotResponseBody[];
  lot: LotResponseBody;
}

/**
 * Vérifie la clôture multi-allocation d'un batch (voir ADR 0006, PRD-11, étape 10) :
 * un lot par allocation, matière première commune calculée une seule fois, packaging
 * ventilé par allocation, généalogie matière répartie au prorata, agrégats du batch
 * dérivés — ainsi que le repli historique pour un batch antérieur à la feature.
 */
describe('BatchClosure — clôture multi-allocation (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let token: string;
  let siteId: string;
  let userId: string;

  const password = 'MotDePasseTest123!';
  const email = 'e2e-batch-closure@lca-mes.local';

  let materialArticleId: string;
  let packagingRefArticleId: string;
  let packagingSecondArticleId: string;
  let finishedProductRefId: string;
  let finishedProductSecondId: string;
  let recipeRefId: string;
  let machineId: string;

  const upsertArticle = async (
    reference: string,
    data: Partial<{ type: ArticleType; unitOfMeasure: string }> = {},
  ) =>
    prisma.article.upsert({
      where: { siteId_openSiReference: { siteId, openSiReference: reference } },
      update: {},
      create: {
        siteId,
        type: data.type ?? ArticleType.PRODUIT_FINI,
        openSiReference: reference,
        name: reference,
        unitOfMeasure: data.unitOfMeasure ?? 'unité',
        currentUnitCost: 1,
      },
    });

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

    const site =
      (await prisma.site.findFirst()) ??
      (await prisma.site.create({ data: { name: 'Site de test e2e' } }));
    siteId = site.id;
    const passwordHash = await bcrypt.hash(password, 4);

    const user = await prisma.user.upsert({
      where: { email },
      update: { passwordHash, active: true },
      create: {
        siteId,
        fullName: 'Utilisateur Test E2E (clôture)',
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

    const materialArticle = await upsertArticle('E2E-BC-MP', {
      type: ArticleType.MATIERE_PREMIERE,
      unitOfMeasure: 'L',
    });
    materialArticleId = materialArticle.id;

    const packagingRef = await upsertArticle('E2E-BC-PKG-REF', {
      type: ArticleType.PACKAGING,
    });
    packagingRefArticleId = packagingRef.id;
    const packagingSecond = await upsertArticle('E2E-BC-PKG-2', {
      type: ArticleType.PACKAGING,
    });
    packagingSecondArticleId = packagingSecond.id;

    const finishedProductRef = await upsertArticle('E2E-BC-PF-REF');
    finishedProductRefId = finishedProductRef.id;
    const finishedProductSecond = await upsertArticle('E2E-BC-PF-2');
    finishedProductSecondId = finishedProductSecond.id;

    // Format 100 ml, matière première à 100% : besoin = 0.1 L par unité produite,
    // packaging = 1 unité par unité produite (calcul volontairement simple).
    const recipeRef = await prisma.recipe.create({
      data: {
        siteId,
        finishedProductId: finishedProductRefId,
        format: 100,
        version: 1,
        status: RecipeStatus.ACTIVE,
        lines: {
          create: [
            { articleId: materialArticleId, quantityPerUnit: 100, unit: '%' },
            {
              articleId: packagingRefArticleId,
              quantityPerUnit: 1,
              unit: 'unité',
            },
          ],
        },
      },
    });
    recipeRefId = recipeRef.id;

    // Recette compatible (même format, même composition matière première) mais avec
    // un packaging distinct — utilisée pour la seconde allocation.
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

    const machine = await prisma.machine.create({
      data: {
        siteId,
        name: 'Machine test e2e (clôture)',
        supportedFormats: [100],
        active: true,
      },
    });
    machineId = machine.id;
  });

  afterAll(async () => {
    if (prisma) {
      const productIds = [finishedProductRefId, finishedProductSecondId];
      await prisma.lotGenealogy.deleteMany({
        where: { lot: { batch: { recipeId: recipeRefId } } },
      });
      await prisma.lot.deleteMany({
        where: { batch: { recipeId: recipeRefId } },
      });
      await prisma.stockMovement.deleteMany({
        where: {
          articleId: {
            in: [
              materialArticleId,
              packagingRefArticleId,
              packagingSecondArticleId,
            ],
          },
        },
      });
      await prisma.batchProductAllocation.deleteMany({
        where: { batch: { recipeId: recipeRefId } },
      });
      await prisma.batch.deleteMany({ where: { recipeId: recipeRefId } });
      await prisma.recipeLine.deleteMany({
        where: { recipe: { finishedProductId: { in: productIds } } },
      });
      await prisma.recipe.deleteMany({
        where: { finishedProductId: { in: productIds } },
      });
      await prisma.machine.deleteMany({ where: { id: machineId } });
      await prisma.stockItem.deleteMany({
        where: {
          articleId: {
            in: [
              materialArticleId,
              packagingRefArticleId,
              packagingSecondArticleId,
            ],
          },
        },
      });
      await prisma.stockLot.deleteMany({
        where: {
          articleId: {
            in: [
              materialArticleId,
              packagingRefArticleId,
              packagingSecondArticleId,
            ],
          },
        },
      });
      await prisma.article.deleteMany({
        where: {
          id: {
            in: [
              ...productIds,
              materialArticleId,
              packagingRefArticleId,
              packagingSecondArticleId,
            ],
          },
        },
      });
      await prisma.user.deleteMany({ where: { email } });
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
        supplierLotNumber: `E2E-BC-LOT-${articleId}-${Date.now()}-${Math.random()}`,
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

  async function createBatch(plannedQuantity: number): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/batching/batches')
      .set('Authorization', `Bearer ${token}`)
      .send({ recipeId: recipeRefId, machineId, plannedQuantity })
      .expect(201);
    return (response.body as { id: string }).id;
  }

  async function advanceToConditionnement(batchId: string): Promise<void> {
    for (let i = 0; i < 4; i += 1) {
      await request(app.getHttpServer())
        .post(`/production/batches/${batchId}/advance-step`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    }
  }

  async function getSoleAllocationId(batchId: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .get(`/batching/batches/${batchId}/allocations`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return (response.body as AllocationResponseBody[])[0].id;
  }

  describe('batch historique sans allocation', () => {
    it('clôture avec les champs racine, génère un lot unique sans allocationId, expose lots et lot', async () => {
      await provisionStock(materialArticleId, 100);
      await provisionStock(packagingRefArticleId, 1000);

      const historicalBatch = await prisma.batch.create({
        data: {
          siteId,
          recipeId: recipeRefId,
          machineId,
          format: 100,
          plannedQuantity: 500,
          status: BatchStatus.EN_COURS,
          currentStep: BatchStep.CONDITIONNEMENT,
          createdByUserId: userId,
        },
      });

      const response = await request(app.getHttpServer())
        .post(`/production/batches/${historicalBatch.id}/close`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          producedQuantity: 480,
          rejectedQuantity: 20,
          endedAt: '2026-07-06T16:00:00.000Z',
        })
        .expect(200);

      const body = response.body as BatchClosureResponseBody;
      expect(body.lots).toHaveLength(1);
      expect(body.lots[0].allocationId).toBeNull();
      expect(body.lots[0].quantity).toBe(500); // 480 + 20
      expect(body.lot).toEqual(body.lots[0]);
      expect(body.batch.producedQuantity).toBe(480);
      expect(body.batch.rejectedQuantity).toBe(20);
      expect(body.batch.status).toBe(BatchStatus.TERMINE);
    });
  });

  describe('batch à une allocation', () => {
    it('clôture via allocations[], génère un lot avec allocationId, met à jour l’allocation', async () => {
      await provisionStock(materialArticleId, 100);
      await provisionStock(packagingRefArticleId, 1000);
      const batchId = await createBatch(500);
      await advanceToConditionnement(batchId);
      const allocationId = await getSoleAllocationId(batchId);

      const response = await request(app.getHttpServer())
        .post(`/production/batches/${batchId}/close`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          endedAt: '2026-07-06T16:00:00.000Z',
          allocations: [
            { allocationId, producedQuantity: 480, rejectedQuantity: 20 },
          ],
        })
        .expect(200);

      const body = response.body as BatchClosureResponseBody;
      expect(body.lots).toHaveLength(1);
      expect(body.lots[0].allocationId).toBe(allocationId);
      expect(body.lot).toEqual(body.lots[0]);

      const allocation = await prisma.batchProductAllocation.findUniqueOrThrow({
        where: { id: allocationId },
      });
      expect(allocation.producedQuantity).toBe(480);
      expect(allocation.rejectedQuantity).toBe(20);
    });

    it('rejette un tableau allocations incomplet (allocation manquante)', async () => {
      await provisionStock(materialArticleId, 100);
      await provisionStock(packagingRefArticleId, 1000);
      const batchId = await createBatch(200);
      await advanceToConditionnement(batchId);

      await request(app.getHttpServer())
        .post(`/production/batches/${batchId}/close`)
        .set('Authorization', `Bearer ${token}`)
        .send({ endedAt: '2026-07-06T16:00:00.000Z', allocations: [] })
        .expect(400);
    });

    it('compatibilité transitoire : accepte l’ancien format (champs racine) du frontend actuel pour une seule allocation', async () => {
      await provisionStock(materialArticleId, 100);
      await provisionStock(packagingRefArticleId, 1000);
      const batchId = await createBatch(500);
      await advanceToConditionnement(batchId);
      const allocationId = await getSoleAllocationId(batchId);

      const response = await request(app.getHttpServer())
        .post(`/production/batches/${batchId}/close`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          producedQuantity: 480,
          rejectedQuantity: 20,
          endedAt: '2026-07-06T16:00:00.000Z',
        })
        .expect(200);

      const body = response.body as BatchClosureResponseBody;
      expect(body.lots).toHaveLength(1);
      expect(body.lots[0].allocationId).toBe(allocationId);
      expect(body.lot).toEqual(body.lots[0]);

      const allocation = await prisma.batchProductAllocation.findUniqueOrThrow({
        where: { id: allocationId },
      });
      expect(allocation.producedQuantity).toBe(480);
      expect(allocation.rejectedQuantity).toBe(20);
    });
  });

  describe('batch à deux allocations', () => {
    async function createTwoAllocationBatch(): Promise<{
      batchId: string;
      allocationRefId: string;
      allocationSecondId: string;
    }> {
      const batchId = await createBatch(100);
      const addResponse = await request(app.getHttpServer())
        .post(`/batching/batches/${batchId}/allocations`)
        .set('Authorization', `Bearer ${token}`)
        .send({ productId: finishedProductSecondId, plannedQuantity: 50 })
        .expect(201);
      const allocationSecondId = (addResponse.body as AllocationResponseBody)
        .id;

      const listResponse = await request(app.getHttpServer())
        .get(`/batching/batches/${batchId}/allocations`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const allocations = listResponse.body as AllocationResponseBody[];
      const allocationRefId = allocations.find(
        (allocation) => allocation.productId === finishedProductRefId,
      )!.id;

      await advanceToConditionnement(batchId);
      return { batchId, allocationRefId, allocationSecondId };
    }

    it('rejette l’ancien format (champs racine) dès que le batch a plusieurs allocations', async () => {
      await provisionStock(materialArticleId, 100);
      await provisionStock(packagingRefArticleId, 200);
      await provisionStock(packagingSecondArticleId, 200);
      const { batchId } = await createTwoAllocationBatch();

      await request(app.getHttpServer())
        .post(`/production/batches/${batchId}/close`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          producedQuantity: 145,
          rejectedQuantity: 5,
          endedAt: '2026-07-06T16:00:00.000Z',
        })
        .expect(400);
    });

    it('crée un Lot par allocation, ventile le packaging, répartit la généalogie matière et dérive les agrégats du batch', async () => {
      await provisionStock(materialArticleId, 100); // 15 L nécessaires (150 unités * 0.1 L)
      await provisionStock(packagingRefArticleId, 200); // 100 nécessaires
      await provisionStock(packagingSecondArticleId, 200); // 50 nécessaires
      const { batchId, allocationRefId, allocationSecondId } =
        await createTwoAllocationBatch();

      const response = await request(app.getHttpServer())
        .post(`/production/batches/${batchId}/close`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          endedAt: '2026-07-06T16:00:00.000Z',
          allocations: [
            {
              allocationId: allocationRefId,
              producedQuantity: 95,
              rejectedQuantity: 5,
            },
            {
              allocationId: allocationSecondId,
              producedQuantity: 48,
              rejectedQuantity: 2,
            },
          ],
        })
        .expect(200);

      const body = response.body as BatchClosureResponseBody;
      expect(body.lots).toHaveLength(2);
      const lotRef = body.lots.find(
        (lot) => lot.allocationId === allocationRefId,
      )!;
      const lotSecond = body.lots.find(
        (lot) => lot.allocationId === allocationSecondId,
      )!;
      expect(lotRef.quantity).toBe(100); // 95 + 5
      expect(lotSecond.quantity).toBe(50); // 48 + 2

      // Batch : agrégats dérivés des allocations.
      expect(body.batch.producedQuantity).toBe(143); // 95 + 48
      expect(body.batch.rejectedQuantity).toBe(7); // 5 + 2

      // Packaging ventilé par allocation.
      const movements = await prisma.stockMovement.findMany({
        where: {
          batchId,
          articleId: { in: [packagingRefArticleId, packagingSecondArticleId] },
        },
      });
      expect(movements.every((m) => m.batchProductAllocationId !== null)).toBe(
        true,
      );
      expect(
        movements
          .filter((m) => m.articleId === packagingRefArticleId)
          .every((m) => m.batchProductAllocationId === allocationRefId),
      ).toBe(true);
      expect(
        movements
          .filter((m) => m.articleId === packagingSecondArticleId)
          .every((m) => m.batchProductAllocationId === allocationSecondId),
      ).toBe(true);

      // Matière première : mouvements sans batchProductAllocationId, jamais ventilés.
      const materialMovements = await prisma.stockMovement.findMany({
        where: { batchId, articleId: materialArticleId },
      });
      expect(
        materialMovements.every((m) => m.batchProductAllocationId === null),
      ).toBe(true);

      // Généalogie matière : reconstitution exacte de la quantité consommée (15 L).
      const genealogyLines = await prisma.lotGenealogy.findMany({
        where: {
          lotId: { in: [lotRef.id, lotSecond.id] },
          consumedArticleId: materialArticleId,
        },
      });
      const totalGenealogy = genealogyLines.reduce(
        (sum, line) => sum + Number(line.consumedQuantity),
        0,
      );
      expect(totalGenealogy).toBeCloseTo(15, 6); // (100 + 50 unités traitées) * 0.1 L
    });

    it('rejette un allocationId dupliqué dans le tableau', async () => {
      await provisionStock(materialArticleId, 100);
      await provisionStock(packagingRefArticleId, 200);
      await provisionStock(packagingSecondArticleId, 200);
      const { batchId, allocationRefId } = await createTwoAllocationBatch();

      await request(app.getHttpServer())
        .post(`/production/batches/${batchId}/close`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          endedAt: '2026-07-06T16:00:00.000Z',
          allocations: [
            {
              allocationId: allocationRefId,
              producedQuantity: 50,
              rejectedQuantity: 0,
            },
            {
              allocationId: allocationRefId,
              producedQuantity: 50,
              rejectedQuantity: 0,
            },
          ],
        })
        .expect(400);
    });

    it('annule tout (aucun lot, aucun mouvement, batch inchangé) si le stock packaging de la seconde allocation devient insuffisant avant la clôture', async () => {
      await provisionStock(materialArticleId, 100);
      await provisionStock(packagingRefArticleId, 200); // suffisant pour la 1ère allocation
      await provisionStock(packagingSecondArticleId, 200); // suffisant au lancement (feasibility)
      const { batchId, allocationRefId, allocationSecondId } =
        await createTwoAllocationBatch();

      // Simule une consommation externe entre le lancement et la clôture (ex : autre
      // batch, correction d'inventaire) — le stock devient insuffisant pour la 2e
      // allocation (50 nécessaires) sans jamais repasser par la faisabilité.
      await prisma.stockLot.updateMany({
        where: { articleId: packagingSecondArticleId },
        data: { remainingQuantity: 5 },
      });
      await prisma.stockItem.updateMany({
        where: { articleId: packagingSecondArticleId },
        data: { availableQuantity: 5 },
      });

      await request(app.getHttpServer())
        .post(`/production/batches/${batchId}/close`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          endedAt: '2026-07-06T16:00:00.000Z',
          allocations: [
            {
              allocationId: allocationRefId,
              producedQuantity: 100,
              rejectedQuantity: 0,
            },
            {
              allocationId: allocationSecondId,
              producedQuantity: 50,
              rejectedQuantity: 0,
            },
          ],
        })
        .expect(400);

      const batch = await prisma.batch.findUniqueOrThrow({
        where: { id: batchId },
      });
      expect(batch.status).toBe(BatchStatus.EN_COURS);
      expect(batch.producedQuantity).toBeNull();

      const lots = await prisma.lot.findMany({ where: { batchId } });
      expect(lots).toHaveLength(0);
    });
  });
});
