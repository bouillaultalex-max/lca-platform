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

interface BatchResponseBody {
  id: string;
  plannedQuantity: number;
}

interface AllocationResponseBody {
  id: string;
  batchId: string;
  productId: string;
  recipeId: string;
  marketId: string | null;
  plannedQuantity: number;
}

/**
 * Vérifie le contrôleur `BatchProductAllocationsController` (voir ADR 0006, PRD-11,
 * étape 5) : ajout d'une allocation via un marché résolu automatiquement, via un
 * produit direct, et les validations métier associées. `createInitialAllocation`
 * n'a volontairement aucune route HTTP (appelée uniquement depuis
 * `BatchesService.create`, étape 6, pas encore câblée) : tout batch créé aujourd'hui
 * démarre donc sans aucune allocation, ce que le premier test ci-dessous vérifie.
 */
describe('BatchProductAllocations (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let token: string;
  let siteId: string;

  const password = 'MotDePasseTest123!';
  const email = 'e2e-batch-product-allocations@lca-mes.local';

  let materialArticleId: string;
  let otherMaterialArticleId: string;
  let machineId: string;

  let marketFrId: string;
  let marketChId: string;
  let productFamilyId: string;

  let productFrId: string; // référence du batch, membre de la famille (marché FR)
  let productChId: string; // membre de la même famille (marché CH)
  let productStandaloneId: string; // sans famille commerciale
  let productNoRecipeId: string; // sans famille, sans recette active
  let productInactiveId: string; // sans famille, désactivé après création de sa recette
  let packagingArticleId: string; // pas un PRODUIT_FINI
  let productFormatMismatchId: string;
  let productMaterialMismatchId: string;
  let productQuantityMismatchId: string;

  let recipeRefId: string;

  const upsertArticle = async (
    reference: string,
    data: Partial<{
      type: ArticleType;
      name: string;
      unitOfMeasure: string;
      active: boolean;
      productFamilyId: string | null;
      marketId: string | null;
    }> = {},
  ) =>
    prisma.article.upsert({
      where: { siteId_openSiReference: { siteId, openSiReference: reference } },
      update: {
        active: data.active ?? true,
        productFamilyId: data.productFamilyId ?? null,
        marketId: data.marketId ?? null,
      },
      create: {
        siteId,
        type: data.type ?? ArticleType.PRODUIT_FINI,
        openSiReference: reference,
        name: data.name ?? reference,
        unitOfMeasure: data.unitOfMeasure ?? 'unité',
        currentUnitCost: 1,
        active: data.active ?? true,
        productFamilyId: data.productFamilyId ?? null,
        marketId: data.marketId ?? null,
      },
    });

  const createRecipe = (
    finishedProductId: string,
    format: number,
    lines: { articleId: string; quantityPerUnit: number }[],
  ) =>
    prisma.recipe.create({
      data: {
        siteId,
        finishedProductId,
        format,
        version: 1,
        status: RecipeStatus.ACTIVE,
        lines: {
          create: lines.map((line) => ({ ...line, unit: '%' })),
        },
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

    await prisma.user.upsert({
      where: { email },
      update: { passwordHash, active: true },
      create: {
        siteId,
        fullName: 'Utilisateur Test E2E (allocations)',
        email,
        passwordHash,
        role: UserRole.RESPONSABLE_LABORATOIRE,
      },
    });
    const loginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password });
    token = (loginResponse.body as LoginResponseBody).accessToken;

    const materialArticle = await upsertArticle('E2E-BPA-MP', {
      type: ArticleType.MATIERE_PREMIERE,
      unitOfMeasure: 'L',
    });
    materialArticleId = materialArticle.id;

    const otherMaterialArticle = await upsertArticle('E2E-BPA-MP-2', {
      type: ArticleType.MATIERE_PREMIERE,
      unitOfMeasure: 'L',
    });
    otherMaterialArticleId = otherMaterialArticle.id;

    const packagingArticle = await upsertArticle('E2E-BPA-PKG', {
      type: ArticleType.PACKAGING,
      unitOfMeasure: 'unité',
    });
    packagingArticleId = packagingArticle.id;

    const machine = await prisma.machine.create({
      data: {
        siteId,
        name: 'Machine test e2e (allocations)',
        supportedFormats: [100, 200],
        active: true,
      },
    });
    machineId = machine.id;

    const marketFr = await prisma.market.create({
      data: { siteId, code: `E2E-FR-${Date.now()}`, label: 'France (e2e)' },
    });
    marketFrId = marketFr.id;
    const marketCh = await prisma.market.create({
      data: { siteId, code: `E2E-CH-${Date.now()}`, label: 'Suisse (e2e)' },
    });
    marketChId = marketCh.id;

    const productFamily = await prisma.productFamily.create({
      data: { siteId, name: `Famille e2e ${Date.now()}` },
    });
    productFamilyId = productFamily.id;

    const productFr = await upsertArticle('E2E-BPA-PF-FR', {
      productFamilyId,
      marketId: marketFrId,
    });
    productFrId = productFr.id;
    const productCh = await upsertArticle('E2E-BPA-PF-CH', {
      productFamilyId,
      marketId: marketChId,
    });
    productChId = productCh.id;

    const productStandalone = await upsertArticle('E2E-BPA-STANDALONE');
    productStandaloneId = productStandalone.id;
    const productNoRecipe = await upsertArticle('E2E-BPA-NORECIPE');
    productNoRecipeId = productNoRecipe.id;
    const productInactive = await upsertArticle('E2E-BPA-INACTIVE');
    productInactiveId = productInactive.id;
    const productFormatMismatch = await upsertArticle('E2E-BPA-FORMAT-MM');
    productFormatMismatchId = productFormatMismatch.id;
    const productMaterialMismatch = await upsertArticle('E2E-BPA-MATERIAL-MM');
    productMaterialMismatchId = productMaterialMismatch.id;
    const productQuantityMismatch = await upsertArticle('E2E-BPA-QUANTITY-MM');
    productQuantityMismatchId = productQuantityMismatch.id;

    const recipeRef = await createRecipe(productFrId, 100, [
      { articleId: materialArticleId, quantityPerUnit: 100 },
    ]);
    recipeRefId = recipeRef.id;
    await createRecipe(productChId, 100, [
      { articleId: materialArticleId, quantityPerUnit: 100 },
    ]);
    await createRecipe(productStandaloneId, 100, [
      { articleId: materialArticleId, quantityPerUnit: 100 },
    ]);
    await createRecipe(productInactiveId, 100, [
      { articleId: materialArticleId, quantityPerUnit: 100 },
    ]);
    // Désactivé après coup : contourne volontairement le garde-fou de RecipesService
    // (qui empêche de créer une recette pour un produit désactivé) pour obtenir un
    // produit désactivé possédant malgré tout une recette active, cas nécessaire ici.
    await prisma.article.update({
      where: { id: productInactiveId },
      data: { active: false },
    });
    await createRecipe(productFormatMismatchId, 200, [
      { articleId: materialArticleId, quantityPerUnit: 100 },
    ]);
    await createRecipe(productMaterialMismatchId, 100, [
      { articleId: otherMaterialArticleId, quantityPerUnit: 100 },
    ]);
    await createRecipe(productQuantityMismatchId, 100, [
      { articleId: materialArticleId, quantityPerUnit: 90 },
    ]);
  });

  afterAll(async () => {
    if (prisma) {
      const productIds = [
        productFrId,
        productChId,
        productStandaloneId,
        productNoRecipeId,
        productInactiveId,
        packagingArticleId,
        productFormatMismatchId,
        productMaterialMismatchId,
        productQuantityMismatchId,
      ];
      await prisma.batchProductAllocation.deleteMany({
        where: { productId: { in: productIds } },
      });
      await prisma.batch.deleteMany({ where: { recipeId: recipeRefId } });
      await prisma.recipeLine.deleteMany({
        where: { recipe: { finishedProductId: { in: productIds } } },
      });
      await prisma.recipe.deleteMany({
        where: { finishedProductId: { in: productIds } },
      });
      await prisma.machine.deleteMany({ where: { id: machineId } });
      await prisma.article.deleteMany({
        where: {
          id: {
            in: [...productIds, materialArticleId, otherMaterialArticleId],
          },
        },
      });
      await prisma.productFamily.deleteMany({ where: { id: productFamilyId } });
      await prisma.market.deleteMany({
        where: { id: { in: [marketFrId, marketChId] } },
      });
      await prisma.user.deleteMany({ where: { email } });
    }
    if (app) {
      await app.close();
    }
  });

  async function createBatch(plannedQuantity = 500): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/batching/batches')
      .set('Authorization', `Bearer ${token}`)
      .send({ recipeId: recipeRefId, machineId, plannedQuantity })
      .expect(201);
    return (response.body as BatchResponseBody).id;
  }

  async function getBatch(batchId: string): Promise<BatchResponseBody> {
    const response = await request(app.getHttpServer())
      .get(`/batching/batches/${batchId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return response.body as BatchResponseBody;
  }

  describe('GET /batching/batches/:batchId/allocations', () => {
    it("retourne une liste vide pour un batch fraîchement créé (aucune allocation initiale tant que l'étape 6 n'est pas câblée)", async () => {
      const batchId = await createBatch();

      const response = await request(app.getHttpServer())
        .get(`/batching/batches/${batchId}/allocations`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body).toEqual([]);
    });

    it('rejette une requête sans authentification', async () => {
      const batchId = await createBatch();
      await request(app.getHttpServer())
        .get(`/batching/batches/${batchId}/allocations`)
        .expect(401);
    });
  });

  describe('POST /batching/batches/:batchId/allocations', () => {
    it('ajoute une allocation via un marché résolu automatiquement', async () => {
      const batchId = await createBatch(500);

      const response = await request(app.getHttpServer())
        .post(`/batching/batches/${batchId}/allocations`)
        .set('Authorization', `Bearer ${token}`)
        .send({ marketId: marketChId, plannedQuantity: 150 })
        .expect(201);

      const body = response.body as AllocationResponseBody;
      expect(body).toMatchObject({
        batchId,
        productId: productChId,
        marketId: marketChId,
        plannedQuantity: 150,
      });

      const batch = await getBatch(batchId);
      expect(batch.plannedQuantity).toBe(650); // 500 + 150, increment atomique

      const allocations = await request(app.getHttpServer())
        .get(`/batching/batches/${batchId}/allocations`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(allocations.body).toHaveLength(1);
    });

    it('ajoute une allocation via un produit direct sans famille commerciale, en plus de la première', async () => {
      const batchId = await createBatch(500);
      await request(app.getHttpServer())
        .post(`/batching/batches/${batchId}/allocations`)
        .set('Authorization', `Bearer ${token}`)
        .send({ marketId: marketChId, plannedQuantity: 150 })
        .expect(201);

      const response = await request(app.getHttpServer())
        .post(`/batching/batches/${batchId}/allocations`)
        .set('Authorization', `Bearer ${token}`)
        .send({ productId: productStandaloneId, plannedQuantity: 100 })
        .expect(201);

      expect(response.body).toMatchObject({
        batchId,
        productId: productStandaloneId,
        marketId: null,
        plannedQuantity: 100,
      });

      const batch = await getBatch(batchId);
      expect(batch.plannedQuantity).toBe(750); // 500 + 150 + 100

      const allocations = await request(app.getHttpServer())
        .get(`/batching/batches/${batchId}/allocations`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(allocations.body).toHaveLength(2);
    });

    it('rejette un produit direct appartenant en réalité à une famille commerciale', async () => {
      const batchId = await createBatch();
      await request(app.getHttpServer())
        .post(`/batching/batches/${batchId}/allocations`)
        .set('Authorization', `Bearer ${token}`)
        .send({ productId: productChId, plannedQuantity: 100 })
        .expect(400);
    });

    it('rejette un produit désactivé', async () => {
      const batchId = await createBatch();
      await request(app.getHttpServer())
        .post(`/batching/batches/${batchId}/allocations`)
        .set('Authorization', `Bearer ${token}`)
        .send({ productId: productInactiveId, plannedQuantity: 100 })
        .expect(400);
    });

    it("rejette un article qui n'est pas de type PRODUIT_FINI", async () => {
      const batchId = await createBatch();
      await request(app.getHttpServer())
        .post(`/batching/batches/${batchId}/allocations`)
        .set('Authorization', `Bearer ${token}`)
        .send({ productId: packagingArticleId, plannedQuantity: 100 })
        .expect(400);
    });

    it('rejette un produit sans recette active à ce format', async () => {
      const batchId = await createBatch();
      await request(app.getHttpServer())
        .post(`/batching/batches/${batchId}/allocations`)
        .set('Authorization', `Bearer ${token}`)
        .send({ productId: productNoRecipeId, plannedQuantity: 100 })
        .expect(400);
    });

    it('rejette une recette candidate dont le format diverge (FORMAT_MISMATCH)', async () => {
      const batchId = await createBatch();
      await request(app.getHttpServer())
        .post(`/batching/batches/${batchId}/allocations`)
        .set('Authorization', `Bearer ${token}`)
        .send({ productId: productFormatMismatchId, plannedQuantity: 100 })
        .expect(400);
    });

    it('rejette une recette candidate dont la matière première diverge (MATERIAL_MISMATCH)', async () => {
      const batchId = await createBatch();
      await request(app.getHttpServer())
        .post(`/batching/batches/${batchId}/allocations`)
        .set('Authorization', `Bearer ${token}`)
        .send({ productId: productMaterialMismatchId, plannedQuantity: 100 })
        .expect(400);
    });

    it('rejette une recette candidate dont une quantité par unité diverge (QUANTITY_MISMATCH)', async () => {
      const batchId = await createBatch();
      await request(app.getHttpServer())
        .post(`/batching/batches/${batchId}/allocations`)
        .set('Authorization', `Bearer ${token}`)
        .send({ productId: productQuantityMismatchId, plannedQuantity: 100 })
        .expect(400);
    });

    it('rejette un doublon de produit déjà alloué dans ce batch', async () => {
      const batchId = await createBatch();
      await request(app.getHttpServer())
        .post(`/batching/batches/${batchId}/allocations`)
        .set('Authorization', `Bearer ${token}`)
        .send({ productId: productStandaloneId, plannedQuantity: 100 })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/batching/batches/${batchId}/allocations`)
        .set('Authorization', `Bearer ${token}`)
        .send({ productId: productStandaloneId, plannedQuantity: 50 })
        .expect(409);
    });

    it('rejette une quantité planifiée nulle ou négative (validation de la requête)', async () => {
      const batchId = await createBatch();
      await request(app.getHttpServer())
        .post(`/batching/batches/${batchId}/allocations`)
        .set('Authorization', `Bearer ${token}`)
        .send({ productId: productStandaloneId, plannedQuantity: 0 })
        .expect(400);
    });

    it('rejette à la fois un marché et un produit fournis ensemble', async () => {
      const batchId = await createBatch();
      await request(app.getHttpServer())
        .post(`/batching/batches/${batchId}/allocations`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          marketId: marketChId,
          productId: productStandaloneId,
          plannedQuantity: 100,
        })
        .expect(400);
    });

    it("rejette l'ajout une fois le conditionnement atteint", async () => {
      const batchId = await createBatch();
      await prisma.batch.update({
        where: { id: batchId },
        data: {
          status: BatchStatus.EN_COURS,
          currentStep: BatchStep.CONDITIONNEMENT,
        },
      });

      await request(app.getHttpServer())
        .post(`/batching/batches/${batchId}/allocations`)
        .set('Authorization', `Bearer ${token}`)
        .send({ productId: productStandaloneId, plannedQuantity: 100 })
        .expect(400);
    });

    it('rejette une requête sans authentification', async () => {
      const batchId = await createBatch();
      await request(app.getHttpServer())
        .post(`/batching/batches/${batchId}/allocations`)
        .send({ productId: productStandaloneId, plannedQuantity: 100 })
        .expect(401);
    });
  });
});
