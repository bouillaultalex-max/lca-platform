import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import * as bcrypt from 'bcryptjs';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ToolRegistryService } from '../src/assistant/tools/tool-registry.service';
import type { LotByNumberToolResult } from '../src/assistant/tools/traceability.tools';
import type { AuthenticatedUser } from '../src/auth/types/authenticated-user';
import {
  ArticleType,
  BatchStatus,
  BatchStep,
  LotQualityStatus,
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

interface BatchClosureResponseBody {
  lots: Array<{ id: string; lotNumber: string; allocationId: string | null }>;
}

interface TraceabilityOriginBody {
  id: string;
  lotNumber: string;
  allocationId: string | null;
  batch: {
    id: string;
    recipe: { id: string; finishedProduct: { id: string; name: string } };
  };
  allocation: {
    id: string;
    product: { id: string; name: string };
    market: { id: string; code: string; label: string } | null;
    recipe: { id: string; version: number; format: number };
  } | null;
}

interface LotTraceabilityResponseBody extends TraceabilityOriginBody {
  genealogyLines: Array<{
    consumedArticle: { id: string };
    consumedStockLot: { id: string };
  }>;
}

interface StockLotTraceabilityResponseBody {
  id: string;
  genealogyLines: Array<{ id: string; lot: TraceabilityOriginBody }>;
}

/**
 * Non-régression du bug D2 : pour un lot possédant une allocation (PRD-11, ADR
 * 0006), la traçabilité doit exposer le produit, le marché et la recette de cette
 * allocation — jamais ceux de `batch.recipe` (recette de référence du batch,
 * commune à toutes ses allocations). Un lot historique sans allocation conserve
 * `batch.recipe` comme unique source.
 *
 * Contrairement à traceability.e2e-spec.ts (données créées directement via
 * Prisma), cette suite passe volontairement par le parcours réel — création du
 * batch, allocation par marché, lancement, clôture — : c'est ce parcours qui
 * produit des lots dont l'allocation diffère de `batch.recipe`, situation que le
 * bug D2 affichait mal. Site dédié, créé puis nettoyé intégralement ici.
 */
describe('Traceability — produit/marché/recette de l’allocation d’origine (e2e, bug D2)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let token: string;
  let siteId: string;
  let user: AuthenticatedUser;

  const email = `e2e-traceability-allocation-${Date.now()}@lca-mes.local`;
  const password = 'MotDePasseTest123!';

  let marketFrId: string;
  let marketChId: string;
  let productFrId: string;
  let productChId: string;
  let productMonoId: string;
  let recipeFrId: string;
  let recipeChId: string;
  let recipeMonoId: string;
  let machineId: string;
  let materialStockLotId: string;
  let labelChStockLotId: string;

  // Batch multi-marchés (FR = allocation de référence, CH = allocation ajoutée).
  let multiLotNumber: string;
  let multiLotFrId: string;
  let multiLotChId: string;
  let allocationFrId: string;
  let allocationChId: string;
  // Batch mono-produit (produit sans famille commerciale ni marché).
  let monoLotId: string;
  let monoLotNumber: string;
  // Lot historique sans allocation.
  let historicLotId: string;
  let historicLotNumber: string;

  const createdBatchIds: string[] = [];

  function http() {
    return request(app.getHttpServer());
  }

  async function createBatch(
    recipeId: string,
    plannedQuantity: number,
  ): Promise<string> {
    const response = await http()
      .post('/batching/batches')
      .set('Authorization', `Bearer ${token}`)
      .send({ recipeId, machineId, plannedQuantity })
      .expect(201);
    const batchId = (response.body as { id: string }).id;
    createdBatchIds.push(batchId);
    return batchId;
  }

  async function advanceToConditionnement(batchId: string): Promise<void> {
    for (let i = 0; i < 4; i += 1) {
      await http()
        .post(`/production/batches/${batchId}/advance-step`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    }
  }

  async function provisionStock(
    articleId: string,
    quantity: number,
    supplierLotNumber: string,
  ): Promise<string> {
    const stockLot = await prisma.stockLot.create({
      data: {
        siteId,
        articleId,
        supplierLotNumber,
        receivedQuantity: quantity,
        remainingQuantity: quantity,
        receivedAt: new Date('2026-09-01T08:00:00.000Z'),
      },
    });
    await prisma.stockItem.create({
      data: { siteId, articleId, availableQuantity: quantity },
    });
    return stockLot.id;
  }

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

    const site = await prisma.site.create({
      data: { name: 'Site e2e traçabilité — allocations (D2)' },
    });
    siteId = site.id;
    // Amorçage explicite du compteur (ADR 0010 § Décision 5/7), comme les autres
    // suites qui lancent réellement un batch.
    await prisma.lotNumberCounter.create({
      data: { siteId, lastIssuedNumber: 700000 },
    });

    const createdUser = await prisma.user.create({
      data: {
        siteId,
        fullName: 'Utilisateur Test E2E (traçabilité — allocations)',
        email,
        passwordHash: await bcrypt.hash(password, 4),
        role: UserRole.RESPONSABLE_LABORATOIRE,
      },
    });
    user = {
      id: createdUser.id,
      siteId,
      fullName: createdUser.fullName,
      email,
      role: createdUser.role,
      jobTitle: null,
      isSystemAdmin: false,
      mustChangePassword: false,
      lastLoginAt: null,
    };
    const login = await http().post('/auth/login').send({ email, password });
    token = (login.body as LoginResponseBody).accessToken;

    const family = await prisma.productFamily.create({
      data: { siteId, name: 'Recharge Lavande (e2e D2)' },
    });
    const marketFr = await prisma.market.create({
      data: { siteId, code: 'FR', label: 'France' },
    });
    const marketCh = await prisma.market.create({
      data: { siteId, code: 'CH', label: 'Suisse' },
    });
    marketFrId = marketFr.id;
    marketChId = marketCh.id;

    const createArticle = (
      type: ArticleType,
      openSiReference: string,
      name: string,
      extra: { productFamilyId?: string; marketId?: string } = {},
    ) =>
      prisma.article.create({
        data: {
          siteId,
          type,
          openSiReference,
          name,
          unitOfMeasure: type === ArticleType.MATIERE_PREMIERE ? 'L' : 'unité',
          currentUnitCost: 1,
          ...extra,
        },
      });

    const material = await createArticle(
      ArticleType.MATIERE_PREMIERE,
      'E2E-D2-MP',
      'Base lavande (e2e D2)',
    );
    const labelFr = await createArticle(
      ArticleType.PACKAGING,
      'E2E-D2-ETI-FR',
      'Étiquette FR (e2e D2)',
    );
    const labelCh = await createArticle(
      ArticleType.PACKAGING,
      'E2E-D2-ETI-CH',
      'Étiquette CH (e2e D2)',
    );
    const productFr = await createArticle(
      ArticleType.PRODUIT_FINI,
      'E2E-D2-PF-FR',
      'Recharge Lavande FR (e2e D2)',
      { productFamilyId: family.id, marketId: marketFr.id },
    );
    const productCh = await createArticle(
      ArticleType.PRODUIT_FINI,
      'E2E-D2-PF-CH',
      'Recharge Lavande CH (e2e D2)',
      { productFamilyId: family.id, marketId: marketCh.id },
    );
    const productMono = await createArticle(
      ArticleType.PRODUIT_FINI,
      'E2E-D2-PF-MONO',
      'Recharge Menthe mono-produit (e2e D2)',
    );
    productFrId = productFr.id;
    productChId = productCh.id;
    productMonoId = productMono.id;

    const createRecipe = (
      finishedProductId: string,
      version: number,
      labelId: string,
    ) =>
      prisma.recipe.create({
        data: {
          siteId,
          finishedProductId,
          format: 100,
          version,
          status: RecipeStatus.ACTIVE,
          lines: {
            create: [
              { articleId: material.id, quantityPerUnit: 100, unit: '%' },
              { articleId: labelId, quantityPerUnit: 1, unit: 'unité' },
            ],
          },
        },
      });
    // Versions volontairement distinctes : permet de prouver que la recette
    // affichée pour le lot CH est bien celle de son allocation (v2), pas la
    // recette de référence du batch (FR, v1).
    recipeFrId = (await createRecipe(productFr.id, 1, labelFr.id)).id;
    recipeChId = (await createRecipe(productCh.id, 2, labelCh.id)).id;
    recipeMonoId = (await createRecipe(productMono.id, 1, labelFr.id)).id;

    machineId = (
      await prisma.machine.create({
        data: {
          siteId,
          name: 'Machine e2e (traçabilité — allocations)',
          supportedFormats: [100],
          active: true,
        },
      })
    ).id;

    materialStockLotId = await provisionStock(
      material.id,
      100,
      'FOURNISSEUR-E2E-D2-MP',
    );
    await provisionStock(labelFr.id, 500, 'FOURNISSEUR-E2E-D2-ETI-FR');
    labelChStockLotId = await provisionStock(
      labelCh.id,
      500,
      'FOURNISSEUR-E2E-D2-ETI-CH',
    );

    // --- Batch multi-marchés : recette de référence FR + allocation marché CH ---
    const multiBatchId = await createBatch(recipeFrId, 100);
    const addResponse = await http()
      .post(`/batching/batches/${multiBatchId}/allocations`)
      .set('Authorization', `Bearer ${token}`)
      .send({ marketId: marketChId, plannedQuantity: 50 })
      .expect(201);
    allocationChId = (addResponse.body as AllocationResponseBody).id;
    const allocationsResponse = await http()
      .get(`/batching/batches/${multiBatchId}/allocations`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    allocationFrId = (
      allocationsResponse.body as AllocationResponseBody[]
    ).find((allocation) => allocation.productId === productFrId)!.id;
    await advanceToConditionnement(multiBatchId);
    const multiClosure = await http()
      .post(`/production/batches/${multiBatchId}/close`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        endedAt: '2026-09-26T16:00:00.000Z',
        allocations: [
          {
            allocationId: allocationFrId,
            producedQuantity: 100,
            rejectedQuantity: 0,
          },
          {
            allocationId: allocationChId,
            producedQuantity: 50,
            rejectedQuantity: 0,
          },
        ],
      })
      .expect(200);
    const multiLots = (multiClosure.body as BatchClosureResponseBody).lots;
    multiLotNumber = multiLots[0].lotNumber;
    multiLotFrId = multiLots.find(
      (lot) => lot.allocationId === allocationFrId,
    )!.id;
    multiLotChId = multiLots.find(
      (lot) => lot.allocationId === allocationChId,
    )!.id;

    // --- Batch mono-produit : une seule allocation, sans marché ---
    const monoBatchId = await createBatch(recipeMonoId, 20);
    await advanceToConditionnement(monoBatchId);
    const monoClosure = await http()
      .post(`/production/batches/${monoBatchId}/close`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        endedAt: '2026-09-26T17:00:00.000Z',
        producedQuantity: 20,
        rejectedQuantity: 0,
      })
      .expect(200);
    const monoLot = (monoClosure.body as BatchClosureResponseBody).lots[0];
    monoLotId = monoLot.id;
    monoLotNumber = monoLot.lotNumber;

    // --- Lot historique sans allocation (antérieur à PRD-11) ---
    const historicBatch = await prisma.batch.create({
      data: {
        siteId,
        recipeId: recipeFrId,
        machineId,
        format: 100,
        plannedQuantity: 10,
        producedQuantity: 10,
        rejectedQuantity: 0,
        status: BatchStatus.TERMINE,
        currentStep: BatchStep.CONDITIONNEMENT,
        createdByUserId: user.id,
        startedAt: new Date('2026-07-01T08:00:00.000Z'),
        endedAt: new Date('2026-07-01T16:00:00.000Z'),
      },
    });
    createdBatchIds.push(historicBatch.id);
    historicLotNumber = `E2E-D2-HIST-${Date.now()}`;
    const historicLot = await prisma.lot.create({
      data: {
        siteId,
        batchId: historicBatch.id,
        lotNumber: historicLotNumber,
        quantity: 10,
        manufacturedAt: new Date('2026-07-01T16:00:00.000Z'),
        qualityStatus: LotQualityStatus.CONFORME,
      },
    });
    historicLotId = historicLot.id;
    await prisma.lotGenealogy.create({
      data: {
        lotId: historicLotId,
        consumedArticleId: material.id,
        consumedStockLotId: materialStockLotId,
        consumedQuantity: 1,
      },
    });
  });

  afterAll(async () => {
    if (prisma && siteId) {
      await prisma.auditLog.deleteMany({
        where: { entity: 'Batch', entityId: { in: createdBatchIds } },
      });
      await prisma.batchCost.deleteMany({
        where: { batchId: { in: createdBatchIds } },
      });
      await prisma.lotGenealogy.deleteMany({
        where: { lot: { siteId } },
      });
      await prisma.lot.deleteMany({ where: { siteId } });
      await prisma.stockMovement.deleteMany({ where: { siteId } });
      await prisma.batchProductAllocation.deleteMany({
        where: { batchId: { in: createdBatchIds } },
      });
      await prisma.batch.deleteMany({ where: { siteId } });
      await prisma.lotNumberCounter.deleteMany({ where: { siteId } });
      await prisma.stockItem.deleteMany({ where: { siteId } });
      await prisma.stockLot.deleteMany({ where: { siteId } });
      await prisma.recipeLine.deleteMany({ where: { recipe: { siteId } } });
      await prisma.recipe.deleteMany({ where: { siteId } });
      await prisma.machine.deleteMany({ where: { siteId } });
      await prisma.article.deleteMany({ where: { siteId } });
      await prisma.market.deleteMany({ where: { siteId } });
      await prisma.productFamily.deleteMany({ where: { siteId } });
      await prisma.user.deleteMany({ where: { siteId } });
      await prisma.site.deleteMany({ where: { id: siteId } });
    }
    if (app) {
      await app.close();
    }
  });

  describe('batch multi-marchés (FR = référence, CH = allocation ajoutée)', () => {
    it('traçabilité directe par numéro : chaque lot expose le produit, le marché et la recette de SON allocation', async () => {
      const response = await http()
        .get('/traceability/lots')
        .query({ lotNumber: multiLotNumber })
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const lots = response.body as LotTraceabilityResponseBody[];
      expect(lots).toHaveLength(2);

      const lotFr = lots.find((lot) => lot.id === multiLotFrId)!;
      const lotCh = lots.find((lot) => lot.id === multiLotChId)!;

      expect(lotFr.allocation).toMatchObject({
        id: allocationFrId,
        product: { id: productFrId, name: 'Recharge Lavande FR (e2e D2)' },
        market: { id: marketFrId, code: 'FR', label: 'France' },
        recipe: { id: recipeFrId, version: 1, format: 100 },
      });
      expect(lotCh.allocation).toMatchObject({
        id: allocationChId,
        product: { id: productChId, name: 'Recharge Lavande CH (e2e D2)' },
        market: { id: marketChId, code: 'CH', label: 'Suisse' },
        recipe: { id: recipeChId, version: 2, format: 100 },
      });

      // Situation précise du bug D2 : les deux lots partagent la même recette de
      // référence (FR) côté batch — seule l'allocation distingue le lot CH.
      expect(lotCh.batch.recipe.finishedProduct.id).toBe(productFrId);
      expect(lotCh.allocation!.product.id).not.toBe(
        lotCh.batch.recipe.finishedProduct.id,
      );
    });

    it('traçabilité directe par ID : le lot CH expose le produit, le marché et la recette CH', async () => {
      const response = await http()
        .get(`/traceability/lots/${multiLotChId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const lot = response.body as LotTraceabilityResponseBody;

      expect(lot.allocation).toMatchObject({
        product: { id: productChId, name: 'Recharge Lavande CH (e2e D2)' },
        market: { code: 'CH', label: 'Suisse' },
        recipe: { id: recipeChId, version: 2 },
      });
      // Généalogie inchangée par la correction : le lot CH a bien consommé
      // l'étiquette CH (et la matière première commune).
      expect(
        lot.genealogyLines.some(
          (line) => line.consumedStockLot.id === labelChStockLotId,
        ),
      ).toBe(true);
    });

    it('traçabilité inverse (matière première commune) : chaque lot consommateur expose le produit et le marché de son allocation', async () => {
      const response = await http()
        .get(`/traceability/stock-lots/${materialStockLotId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const body = response.body as StockLotTraceabilityResponseBody;

      const consumerFr = body.genealogyLines.find(
        (line) => line.lot.id === multiLotFrId,
      )!;
      const consumerCh = body.genealogyLines.find(
        (line) => line.lot.id === multiLotChId,
      )!;
      expect(consumerFr.lot.allocation).toMatchObject({
        product: { id: productFrId },
        market: { code: 'FR' },
        recipe: { id: recipeFrId },
      });
      expect(consumerCh.lot.allocation).toMatchObject({
        product: { id: productChId, name: 'Recharge Lavande CH (e2e D2)' },
        market: { code: 'CH', label: 'Suisse' },
        recipe: { id: recipeChId, version: 2 },
      });
    });

    it('traçabilité inverse (lot fournisseur d’étiquettes CH) : seul le lot CH apparaît, avec le produit et le marché CH', async () => {
      const response = await http()
        .get(`/traceability/stock-lots/${labelChStockLotId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const body = response.body as StockLotTraceabilityResponseBody;

      expect(body.genealogyLines).toHaveLength(1);
      const consumer = body.genealogyLines[0].lot;
      expect(consumer.id).toBe(multiLotChId);
      expect(consumer.allocation).toMatchObject({
        product: { id: productChId, name: 'Recharge Lavande CH (e2e D2)' },
        market: { code: 'CH', label: 'Suisse' },
        recipe: { id: recipeChId, version: 2 },
      });
    });

    it('outil assistant traceability.getLotByNumber : produit, marché et recette de l’allocation pour chaque lot', async () => {
      const tool = app
        .get(ToolRegistryService)
        .get('traceability.getLotByNumber')!;
      const result = (await tool.handler(user, {
        lotNumber: multiLotNumber,
      })) as LotByNumberToolResult[];

      expect(result).toHaveLength(2);
      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            finishedProductName: 'Recharge Lavande FR (e2e D2)',
            marketLabel: 'France',
            recipeVersion: 1,
          }),
          expect.objectContaining({
            finishedProductName: 'Recharge Lavande CH (e2e D2)',
            marketLabel: 'Suisse',
            recipeVersion: 2,
          }),
        ]),
      );
    });
  });

  describe('batch mono-produit (une seule allocation, sans marché)', () => {
    it('expose l’allocation unique : produit et recette du batch, marché null', async () => {
      const response = await http()
        .get(`/traceability/lots/${monoLotId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const lot = response.body as LotTraceabilityResponseBody;

      expect(lot.allocation).not.toBeNull();
      expect(lot.allocation).toMatchObject({
        product: { id: productMonoId },
        market: null,
        recipe: { id: recipeMonoId },
      });
      // Comportement inchangé pour ce cas : allocation et batch.recipe concordent.
      expect(lot.batch.recipe.finishedProduct.id).toBe(productMonoId);

      const byNumber = await http()
        .get('/traceability/lots')
        .query({ lotNumber: monoLotNumber })
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(byNumber.body as LotTraceabilityResponseBody[]).toHaveLength(1);
    });

    it('outil assistant : produit du batch, marketLabel null', async () => {
      const tool = app
        .get(ToolRegistryService)
        .get('traceability.getLotByNumber')!;
      const result = (await tool.handler(user, {
        lotNumber: monoLotNumber,
      })) as LotByNumberToolResult[];

      expect(result).toEqual([
        expect.objectContaining({
          finishedProductName: 'Recharge Menthe mono-produit (e2e D2)',
          marketLabel: null,
        }),
      ]);
    });
  });

  describe('lot historique sans allocation (antérieur à PRD-11)', () => {
    it('traçabilité directe : allocation null, batch.recipe reste la source (comportement antérieur)', async () => {
      const response = await http()
        .get(`/traceability/lots/${historicLotId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const lot = response.body as LotTraceabilityResponseBody;

      expect(lot.allocationId).toBeNull();
      expect(lot.allocation).toBeNull();
      expect(lot.batch.recipe.finishedProduct).toMatchObject({
        id: productFrId,
        name: 'Recharge Lavande FR (e2e D2)',
      });
    });

    it('traçabilité inverse : le lot historique apparaît avec allocation null', async () => {
      const response = await http()
        .get(`/traceability/stock-lots/${materialStockLotId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const body = response.body as StockLotTraceabilityResponseBody;

      const historic = body.genealogyLines.find(
        (line) => line.lot.id === historicLotId,
      )!;
      expect(historic.lot.allocation).toBeNull();
      expect(historic.lot.batch.recipe.finishedProduct.id).toBe(productFrId);
    });

    it('outil assistant : repli sur batch.recipe, marketLabel null', async () => {
      const tool = app
        .get(ToolRegistryService)
        .get('traceability.getLotByNumber')!;
      const result = (await tool.handler(user, {
        lotNumber: historicLotNumber,
      })) as LotByNumberToolResult[];

      expect(result).toEqual([
        expect.objectContaining({
          finishedProductName: 'Recharge Lavande FR (e2e D2)',
          marketLabel: null,
          recipeVersion: 1,
        }),
      ]);
    });
  });
});
