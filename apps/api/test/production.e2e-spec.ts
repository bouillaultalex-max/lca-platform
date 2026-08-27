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
  RecipeStatus,
  UserRole,
} from '../generated/prisma/client';

interface LoginResponseBody {
  accessToken: string;
}

interface BatchResponseBody {
  id: string;
  status: BatchStatus;
  currentStep: string | null;
  plannedQuantity: number;
}

interface FeasibilityResponseBody {
  isFeasible: boolean;
  requestedQuantity: number;
  shortages: Array<{
    articleId: string;
    articleReference: string;
    unit: string;
    quantityNeeded: number;
    quantityAvailable: number;
    quantityMissing: number;
  }>;
  maxFeasibleQuantity: number | null;
}

/**
 * Vérifie l'analyse de faisabilité avant lancement d'un batch (retour métier de
 * Kevin, voir PROJECT_STATE.md) : recalcul des besoins réels de la recette, comparaison
 * aux stocks disponibles, blocage du lancement (jamais d'écriture) si insuffisant,
 * calcul de la quantité maximale produisible, et possibilité d'ajuster la quantité
 * planifiée d'un batch encore PLANIFIE.
 */
describe('Production — faisabilité de lancement de batch (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let token: string;
  let siteId: string;

  let materialArticleId: string;
  let finishedProductId: string;
  let recipeId: string;
  let machineId: string;
  let secondFinishedProductId: string;

  const password = 'MotDePasseTest123!';
  const email = 'e2e-production-lab@lca-mes.local';
  const materialReference = 'E2E-PROD-MP';
  const finishedProductReference = 'E2E-PROD-FINI';
  const secondFinishedProductReference = 'E2E-PROD-FINI-2';

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
    // ADR 0010 : le lancement (advance-step) exige désormais un LotNumberCounter pour
    // le site — amorçage arbitraire pour les tests, sans rapport avec la valeur réelle
    // 456148 (donnée d'exploitation, jamais codée en dur, voir ADR 0010 § Décision 7).
    await prisma.lotNumberCounter.upsert({
      where: { siteId },
      update: {},
      create: { siteId, lastIssuedNumber: 900000 },
    });
    const passwordHash = await bcrypt.hash(password, 4);

    await prisma.user.upsert({
      where: { email },
      update: { passwordHash, active: true },
      create: {
        siteId,
        fullName: 'Utilisateur Test E2E (production)',
        email,
        passwordHash,
        role: UserRole.RESPONSABLE_LABORATOIRE,
      },
    });
    const loginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password });
    token = (loginResponse.body as LoginResponseBody).accessToken;

    const materialArticle = await prisma.article.upsert({
      where: {
        siteId_openSiReference: { siteId, openSiReference: materialReference },
      },
      update: {},
      create: {
        siteId,
        type: ArticleType.MATIERE_PREMIERE,
        openSiReference: materialReference,
        name: 'Matière première test e2e (production)',
        unitOfMeasure: 'L',
        currentUnitCost: 1,
      },
    });
    materialArticleId = materialArticle.id;

    const finishedProduct = await prisma.article.upsert({
      where: {
        siteId_openSiReference: {
          siteId,
          openSiReference: finishedProductReference,
        },
      },
      update: {},
      create: {
        siteId,
        type: ArticleType.PRODUIT_FINI,
        openSiReference: finishedProductReference,
        name: 'Produit fini test e2e (production)',
        unitOfMeasure: 'unité',
        currentUnitCost: 1,
      },
    });
    finishedProductId = finishedProduct.id;

    // Format 100 ml, une seule ligne de matière première à 100% : besoin = 0.1 L par
    // flacon, quel que soit le nombre de flacons demandé (calcul volontairement simple
    // pour des assertions numériques exactes dans les tests ci-dessous).
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
          ],
        },
      },
    });
    recipeId = recipe.id;

    // Second produit fini, sans famille commerciale, avec une recette compatible
    // (même format, même composition matière première) — utilisé uniquement pour
    // créer une seconde allocation via POST .../allocations (chemin produit direct).
    const secondFinishedProduct = await prisma.article.upsert({
      where: {
        siteId_openSiReference: {
          siteId,
          openSiReference: secondFinishedProductReference,
        },
      },
      update: {},
      create: {
        siteId,
        type: ArticleType.PRODUIT_FINI,
        openSiReference: secondFinishedProductReference,
        name: 'Second produit fini test e2e (production)',
        unitOfMeasure: 'unité',
        currentUnitCost: 1,
      },
    });
    secondFinishedProductId = secondFinishedProduct.id;
    await prisma.recipe.create({
      data: {
        siteId,
        finishedProductId: secondFinishedProductId,
        format: 100,
        version: 1,
        status: RecipeStatus.ACTIVE,
        lines: {
          create: [
            { articleId: materialArticleId, quantityPerUnit: 100, unit: '%' },
          ],
        },
      },
    });

    const machine = await prisma.machine.create({
      data: {
        siteId,
        name: 'Machine test e2e (production)',
        supportedFormats: [100],
        active: true,
      },
    });
    machineId = machine.id;
  });

  afterAll(async () => {
    if (prisma) {
      // Depuis PRD-11 (étape 6), tout batch créé possède désormais une allocation
      // initiale (`BatchProductAllocation.batchId` en ON DELETE RESTRICT) : elle doit
      // être supprimée avant le batch, sous peine de violation de contrainte.
      await prisma.batchProductAllocation.deleteMany({
        where: { batch: { recipeId } },
      });
      await prisma.batch.deleteMany({ where: { recipeId } });
      await prisma.recipeLine.deleteMany({
        where: {
          recipe: {
            finishedProductId: {
              in: [finishedProductId, secondFinishedProductId],
            },
          },
        },
      });
      await prisma.recipe.deleteMany({
        where: {
          finishedProductId: {
            in: [finishedProductId, secondFinishedProductId],
          },
        },
      });
      await prisma.machine.deleteMany({ where: { id: machineId } });
      await prisma.stockMovement.deleteMany({
        where: { articleId: materialArticleId },
      });
      await prisma.stockItem.deleteMany({
        where: { articleId: materialArticleId },
      });
      await prisma.stockLot.deleteMany({
        where: { articleId: materialArticleId },
      });
      await prisma.article.deleteMany({
        where: {
          id: {
            in: [materialArticleId, finishedProductId, secondFinishedProductId],
          },
        },
      });
      await prisma.user.deleteMany({ where: { email } });
    }
    if (app) {
      await app.close();
    }
  });

  async function createBatch(plannedQuantity: number): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/batching/batches')
      .set('Authorization', `Bearer ${token}`)
      .send({ recipeId, machineId, plannedQuantity })
      .expect(201);
    return (response.body as BatchResponseBody).id;
  }

  async function setAvailableStock(quantity: number): Promise<void> {
    // Repart d'un stock à zéro avant chaque scénario, pour des assertions déterministes.
    await prisma.stockMovement.deleteMany({
      where: { articleId: materialArticleId },
    });
    await prisma.stockLot.deleteMany({
      where: { articleId: materialArticleId },
    });
    await prisma.stockItem.deleteMany({
      where: { articleId: materialArticleId },
    });
    if (quantity <= 0) return;
    await prisma.stockLot.create({
      data: {
        siteId,
        articleId: materialArticleId,
        supplierLotNumber: `E2E-LOT-${Date.now()}`,
        receivedQuantity: quantity,
        remainingQuantity: quantity,
        receivedAt: new Date(),
      },
    });
  }

  describe('GET /batching/batches/:id/feasibility', () => {
    it('signale un stock insuffisant avec le détail exact du composant manquant', async () => {
      await setAvailableStock(50); // 50 L dispo
      const batchId = await createBatch(1000); // besoin = 0.1 * 1000 = 100 L

      const response = await request(app.getHttpServer())
        .get(`/batching/batches/${batchId}/feasibility`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = response.body as FeasibilityResponseBody;
      expect(body.isFeasible).toBe(false);
      expect(body.requestedQuantity).toBe(1000);
      expect(body.shortages).toHaveLength(1);
      expect(body.shortages[0]).toMatchObject({
        articleId: materialArticleId,
        articleReference: materialReference,
        unit: 'L',
        quantityNeeded: 100,
        quantityAvailable: 50,
        quantityMissing: 50,
      });
      // rate = 0.1 L/flacon → max = 50 / 0.1 = 500
      expect(body.maxFeasibleQuantity).toBe(500);
    });

    it('signale une faisabilité complète quand le stock couvre le besoin', async () => {
      await setAvailableStock(200); // largement suffisant pour 100 L de besoin
      const batchId = await createBatch(1000);

      const response = await request(app.getHttpServer())
        .get(`/batching/batches/${batchId}/feasibility`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = response.body as FeasibilityResponseBody;
      expect(body.isFeasible).toBe(true);
      expect(body.shortages).toEqual([]);
      expect(body.maxFeasibleQuantity).toBeNull();
    });
  });

  describe('POST /production/batches/:id/advance-step (lancement)', () => {
    it('bloque le lancement si les stocks sont insuffisants, sans modifier le batch', async () => {
      await setAvailableStock(50);
      const batchId = await createBatch(1000);

      const response = await request(app.getHttpServer())
        .post(`/production/batches/${batchId}/advance-step`)
        .set('Authorization', `Bearer ${token}`)
        .expect(400);

      expect((response.body as { message: string }).message).toBe(
        'Ce batch ne peut pas être lancé car les stocks sont insuffisants.',
      );

      const batch = await prisma.batch.findUniqueOrThrow({
        where: { id: batchId },
      });
      expect(batch.status).toBe(BatchStatus.PLANIFIE);
      expect(batch.currentStep).toBeNull();
      expect(batch.startedAt).toBeNull();
    });

    it('autorise le lancement si les stocks sont suffisants', async () => {
      await setAvailableStock(200);
      const batchId = await createBatch(1000);

      const response = await request(app.getHttpServer())
        .post(`/production/batches/${batchId}/advance-step`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = response.body as BatchResponseBody;
      expect(body.status).toBe(BatchStatus.EN_COURS);
      expect(body.currentStep).toBe('PREPARATION');
    });

    it('autorise le lancement d’un batch historique sans aucune allocation (créé directement en base, antérieur à PRD-11)', async () => {
      await setAvailableStock(200);
      const historicalBatch = await prisma.batch.create({
        data: {
          siteId,
          recipeId,
          machineId,
          format: 100,
          plannedQuantity: 1000,
          status: BatchStatus.PLANIFIE,
          createdByUserId: (
            await prisma.user.findFirstOrThrow({ where: { email } })
          ).id,
        },
      });

      const response = await request(app.getHttpServer())
        .post(`/production/batches/${historicalBatch.id}/advance-step`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const body = response.body as BatchResponseBody;
      expect(body.status).toBe(BatchStatus.EN_COURS);
      expect(body.currentStep).toBe('PREPARATION');

      await prisma.batch.deleteMany({ where: { id: historicalBatch.id } });
    });
  });

  describe('PATCH /batching/batches/:id/planned-quantity', () => {
    it('modifie la quantité planifiée d’un batch encore PLANIFIE', async () => {
      await setAvailableStock(50);
      const batchId = await createBatch(1000);

      const response = await request(app.getHttpServer())
        .patch(`/batching/batches/${batchId}/planned-quantity`)
        .set('Authorization', `Bearer ${token}`)
        .send({ plannedQuantity: 500 })
        .expect(200);

      expect((response.body as BatchResponseBody).plannedQuantity).toBe(500);
    });

    it('refuse de modifier la quantité d’un batch déjà lancé (EN_COURS)', async () => {
      await setAvailableStock(200);
      const batchId = await createBatch(1000);
      await request(app.getHttpServer())
        .post(`/production/batches/${batchId}/advance-step`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/batching/batches/${batchId}/planned-quantity`)
        .set('Authorization', `Bearer ${token}`)
        .send({ plannedQuantity: 100 })
        .expect(400);
    });

    it('synchronise l’unique allocation avec la nouvelle quantité planifiée', async () => {
      await setAvailableStock(50);
      const batchId = await createBatch(1000);

      await request(app.getHttpServer())
        .patch(`/batching/batches/${batchId}/planned-quantity`)
        .set('Authorization', `Bearer ${token}`)
        .send({ plannedQuantity: 500 })
        .expect(200);

      const allocation = await prisma.batchProductAllocation.findFirstOrThrow({
        where: { batchId },
      });
      expect(allocation.plannedQuantity).toBe(500);
    });

    it('rejette la modification de quantité d’un batch ayant plusieurs allocations', async () => {
      await setAvailableStock(50);
      const batchId = await createBatch(1000);
      await request(app.getHttpServer())
        .post(`/batching/batches/${batchId}/allocations`)
        .set('Authorization', `Bearer ${token}`)
        .send({ productId: secondFinishedProductId, plannedQuantity: 200 })
        .expect(201);

      const response = await request(app.getHttpServer())
        .patch(`/batching/batches/${batchId}/planned-quantity`)
        .set('Authorization', `Bearer ${token}`)
        .send({ plannedQuantity: 500 })
        .expect(400);

      expect((response.body as { message: string }).message).toContain(
        'plusieurs allocations',
      );
      const batch = await prisma.batch.findUniqueOrThrow({
        where: { id: batchId },
      });
      expect(batch.plannedQuantity).toBe(1200); // 1000 + 200, inchangé
    });

    it('parcours complet : quantité réduite à la valeur maximale annoncée, puis lancement réussi', async () => {
      await setAvailableStock(50);
      const batchId = await createBatch(1000);

      const feasibility = await request(app.getHttpServer())
        .get(`/batching/batches/${batchId}/feasibility`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const maxFeasibleQuantity = (feasibility.body as FeasibilityResponseBody)
        .maxFeasibleQuantity as number;
      expect(maxFeasibleQuantity).toBe(500);

      await request(app.getHttpServer())
        .patch(`/batching/batches/${batchId}/planned-quantity`)
        .set('Authorization', `Bearer ${token}`)
        .send({ plannedQuantity: maxFeasibleQuantity })
        .expect(200);

      const response = await request(app.getHttpServer())
        .post(`/production/batches/${batchId}/advance-step`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect((response.body as BatchResponseBody).status).toBe(
        BatchStatus.EN_COURS,
      );
    });
  });
});
