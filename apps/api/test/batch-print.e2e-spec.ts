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

interface IngredientResponseBody {
  kind: 'MATIERE_PREMIERE' | 'PACKAGING';
  articleId: string;
  articleName: string;
  articleReference: string;
  volumeL?: number;
  massKg?: number | null;
  quantity?: number;
  unit?: string;
}

interface PrintAllocationResponseBody {
  allocationId: string | null;
  productName: string;
  quantityToBatch: number;
  ingredients: IngredientResponseBody[];
}

interface PrintDataResponseBody {
  batchId: string;
  lotNumber: string;
  expiryDate: string;
  allocations: PrintAllocationResponseBody[];
}

/**
 * Impression des étiquettes Brady BBP12 (ADR 0010, étape 7) : `print-data`
 * agrège numéro de lot + DDM réservés au lancement et les ingrédients calculés
 * par allocation, sans jamais dépendre d'un `Lot` réel (qui n'existe pas encore
 * tant que le batch n'est pas clôturé) ni modifier quoi que ce soit.
 *
 * Site dédié (jamais le site partagé « Site de test e2e ») pour la même raison
 * que `batch-closure-numbering.e2e-spec.ts`/`batch-cancel.e2e-spec.ts` : les
 * assertions portent sur des valeurs de compteur exactes.
 */
describe('BatchPrint — impression des étiquettes (e2e, ADR 0010 étape 7)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokenA: string;
  let tokenB: string;
  let siteAId: string;
  let siteBId: string;
  let userAId: string;

  let materialPgId: string;
  let materialVgId: string;
  let packagingAId: string;
  let packagingBId: string;
  let finishedAId: string;
  let finishedBId: string;
  let recipeAId: string;
  let recipeBId: string;
  let machineId: string;

  const createdBatchIds: string[] = [];

  const password = 'MotDePasseTest123!';
  const emailA = 'e2e-batch-print-a@lca-mes.local';
  const emailB = 'e2e-batch-print-b@lca-mes.local';
  const startingCounterValue = 600000;

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

    const siteA = await prisma.site.create({
      data: { name: 'Site e2e batch-print A' },
    });
    const siteB = await prisma.site.create({
      data: { name: 'Site e2e batch-print B' },
    });
    siteAId = siteA.id;
    siteBId = siteB.id;

    await prisma.lotNumberCounter.create({
      data: { siteId: siteAId, lastIssuedNumber: startingCounterValue },
    });

    const passwordHash = await bcrypt.hash(password, 4);
    // `upsert` (voir traceability.e2e-spec.ts) : `email` est unique globalement, un
    // run précédent interrompu avant son `afterAll` laisserait cet e-mail déjà pris.
    const userA = await prisma.user.upsert({
      where: { email: emailA },
      update: { passwordHash, active: true, siteId: siteAId },
      create: {
        siteId: siteAId,
        fullName: 'Utilisateur Test E2E (impression A)',
        email: emailA,
        passwordHash,
        role: UserRole.RESPONSABLE_LABORATOIRE,
      },
    });
    userAId = userA.id;
    await prisma.user.upsert({
      where: { email: emailB },
      update: { passwordHash, active: true, siteId: siteBId },
      create: {
        siteId: siteBId,
        fullName: 'Utilisateur Test E2E (impression B)',
        email: emailB,
        passwordHash,
        role: UserRole.RESPONSABLE_LABORATOIRE,
      },
    });

    const loginA = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: emailA, password });
    tokenA = (loginA.body as LoginResponseBody).accessToken;
    const loginB = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: emailB, password });
    tokenB = (loginB.body as LoginResponseBody).accessToken;

    const materialPg = await prisma.article.create({
      data: {
        siteId: siteAId,
        type: ArticleType.MATIERE_PREMIERE,
        openSiReference: 'E2E-BP-PG',
        name: 'Monopropylène glycol (PG)',
        unitOfMeasure: 'L',
        currentUnitCost: 1,
      },
    });
    materialPgId = materialPg.id;
    const materialVg = await prisma.article.create({
      data: {
        siteId: siteAId,
        type: ArticleType.MATIERE_PREMIERE,
        openSiReference: 'E2E-BP-VG',
        name: 'Glycérine végétale (VG)',
        unitOfMeasure: 'L',
        currentUnitCost: 1,
      },
    });
    materialVgId = materialVg.id;
    const packagingA = await prisma.article.create({
      data: {
        siteId: siteAId,
        type: ArticleType.PACKAGING,
        openSiReference: 'E2E-BP-PKG-A',
        name: 'Flacon A',
        unitOfMeasure: 'unité',
        currentUnitCost: 1,
      },
    });
    packagingAId = packagingA.id;
    const packagingB = await prisma.article.create({
      data: {
        siteId: siteAId,
        type: ArticleType.PACKAGING,
        openSiReference: 'E2E-BP-PKG-B',
        name: 'Flacon B',
        unitOfMeasure: 'unité',
        currentUnitCost: 1,
      },
    });
    packagingBId = packagingB.id;
    const finishedA = await prisma.article.create({
      data: {
        siteId: siteAId,
        type: ArticleType.PRODUIT_FINI,
        openSiReference: 'E2E-BP-PF-A',
        name: 'Produit fini A',
        unitOfMeasure: 'unité',
        currentUnitCost: 1,
      },
    });
    finishedAId = finishedA.id;
    const finishedB = await prisma.article.create({
      data: {
        siteId: siteAId,
        type: ArticleType.PRODUIT_FINI,
        openSiReference: 'E2E-BP-PF-B',
        name: 'Produit fini B',
        unitOfMeasure: 'unité',
        currentUnitCost: 1,
      },
    });
    finishedBId = finishedB.id;

    const machine = await prisma.machine.create({
      data: {
        siteId: siteAId,
        name: 'Machine e2e (impression)',
        supportedFormats: [100],
        active: true,
      },
    });
    machineId = machine.id;

    // Recette A et recette B partagent EXACTEMENT la même composition matière
    // première (PG 60 % + VG 40 %) — obligatoire (ADR 0006 § invariant 5 :
    // « composition matière première strictement compatible avec Batch.recipeId »,
    // un seul mélange commun pour tout le batch) — et diffèrent uniquement par leur
    // packaging propre, pour prouver que les ingrédients calculés par allocation ne
    // sont jamais fusionnés (ADR 0010 § Décision 17) tout en respectant l'invariant.
    const recipeA = await prisma.recipe.create({
      data: {
        siteId: siteAId,
        finishedProductId: finishedAId,
        format: 100,
        version: 1,
        status: RecipeStatus.ACTIVE,
        lines: {
          create: [
            { articleId: materialPgId, quantityPerUnit: 60, unit: '%' },
            { articleId: materialVgId, quantityPerUnit: 40, unit: '%' },
            { articleId: packagingAId, quantityPerUnit: 1, unit: 'unité' },
          ],
        },
      },
    });
    recipeAId = recipeA.id;
    const recipeB = await prisma.recipe.create({
      data: {
        siteId: siteAId,
        finishedProductId: finishedBId,
        format: 100,
        version: 1,
        status: RecipeStatus.ACTIVE,
        lines: {
          create: [
            { articleId: materialPgId, quantityPerUnit: 60, unit: '%' },
            { articleId: materialVgId, quantityPerUnit: 40, unit: '%' },
            { articleId: packagingBId, quantityPerUnit: 1, unit: 'unité' },
          ],
        },
      },
    });
    recipeBId = recipeB.id;
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
      await prisma.lot.deleteMany({ where: { batchId: { in: createdBatchIds } } });
      await prisma.stockMovement.deleteMany({ where: { siteId: siteAId } });
      await prisma.batchProductAllocation.deleteMany({
        where: { batchId: { in: createdBatchIds } },
      });
      await prisma.batch.deleteMany({ where: { id: { in: createdBatchIds } } });
      await prisma.lotNumberCounter.deleteMany({ where: { siteId: siteAId } });
      await prisma.recipeLine.deleteMany({ where: { recipe: { siteId: siteAId } } });
      await prisma.recipe.deleteMany({ where: { siteId: siteAId } });
      await prisma.machine.deleteMany({ where: { siteId: siteAId } });
      await prisma.stockItem.deleteMany({ where: { siteId: siteAId } });
      await prisma.stockLot.deleteMany({ where: { siteId: siteAId } });
      await prisma.article.deleteMany({ where: { siteId: siteAId } });
      await prisma.user.deleteMany({ where: { email: { in: [emailA, emailB] } } });
      await prisma.batch.deleteMany({ where: { siteId: siteBId } });
      await prisma.site.deleteMany({ where: { id: { in: [siteAId, siteBId] } } });
    }
    if (app) {
      await app.close();
    }
  });

  async function provisionStock(articleId: string, quantity: number): Promise<void> {
    await prisma.stockLot.create({
      data: {
        siteId: siteAId,
        articleId,
        supplierLotNumber: `E2E-BP-LOT-${articleId}-${Date.now()}-${Math.random()}`,
        receivedQuantity: quantity,
        remainingQuantity: quantity,
        receivedAt: new Date(),
      },
    });
    await prisma.stockItem.upsert({
      where: { articleId },
      update: { availableQuantity: { increment: quantity } },
      create: { siteId: siteAId, articleId, availableQuantity: quantity },
    });
  }

  async function createBatch(plannedQuantity: number): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/batching/batches')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ recipeId: recipeAId, machineId, plannedQuantity })
      .expect(201);
    const id = (response.body as { id: string }).id;
    createdBatchIds.push(id);
    return id;
  }

  async function addSecondAllocation(
    batchId: string,
    plannedQuantity: number,
  ): Promise<string> {
    const response = await request(app.getHttpServer())
      .post(`/batching/batches/${batchId}/allocations`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ productId: finishedBId, plannedQuantity })
      .expect(201);
    return (response.body as AllocationResponseBody).id;
  }

  async function launchOnly(batchId: string): Promise<void> {
    await request(app.getHttpServer())
      .post(`/production/batches/${batchId}/advance-step`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
  }

  async function advanceToConditionnement(batchId: string): Promise<void> {
    for (let i = 0; i < 4; i += 1) {
      await request(app.getHttpServer())
        .post(`/production/batches/${batchId}/advance-step`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
    }
  }

  async function getCounter(): Promise<number> {
    const counter = await prisma.lotNumberCounter.findUniqueOrThrow({
      where: { siteId: siteAId },
    });
    return counter.lastIssuedNumber;
  }

  function getPrintData(batchId: string, token = tokenA) {
    return request(app.getHttpServer())
      .get(`/production/batches/${batchId}/print-data`)
      .set('Authorization', `Bearer ${token}`);
  }

  describe('batch EN_COURS, deux allocations — cas nominal', () => {
    let batchId: string;
    let allocationRefId: string;
    let allocationSecondId: string;
    let expectedLotNumber: string;

    beforeAll(async () => {
      await provisionStock(materialPgId, 100);
      await provisionStock(materialVgId, 100);
      await provisionStock(packagingAId, 1000);
      await provisionStock(packagingBId, 1000);

      const counterBefore = await getCounter();
      expectedLotNumber = String(counterBefore + 1);

      batchId = await createBatch(300);
      allocationSecondId = await addSecondAllocation(batchId, 150);
      const listResponse = await request(app.getHttpServer())
        .get(`/batching/batches/${batchId}/allocations`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);
      allocationRefId = (listResponse.body as AllocationResponseBody[]).find(
        (a) => a.productId === finishedAId,
      )!.id;

      await launchOnly(batchId);
    });

    it('retourne 200 avec le lotNumber et la DDM réservés au lancement (Batch.reservedLotNumber/reservedExpiryDate)', async () => {
      const batch = await prisma.batch.findUniqueOrThrow({ where: { id: batchId } });
      const response = await getPrintData(batchId).expect(200);
      const body = response.body as PrintDataResponseBody;

      expect(body.batchId).toBe(batchId);
      expect(body.lotNumber).toBe(expectedLotNumber);
      expect(body.lotNumber).toBe(batch.reservedLotNumber);
      expect(new Date(body.expiryDate)).toEqual(batch.reservedExpiryDate);
    });

    it('retourne deux allocations distinctes, jamais fusionnées, avec produit/quantité/ingrédients propres', async () => {
      const response = await getPrintData(batchId).expect(200);
      const body = response.body as PrintDataResponseBody;

      expect(body.allocations).toHaveLength(2);
      const lineRef = body.allocations.find((a) => a.allocationId === allocationRefId)!;
      const lineSecond = body.allocations.find(
        (a) => a.allocationId === allocationSecondId,
      )!;

      expect(lineRef.productName).toBe('Produit fini A');
      expect(lineRef.quantityToBatch).toBe(300);
      expect(lineSecond.productName).toBe('Produit fini B');
      expect(lineSecond.quantityToBatch).toBe(150);

      // PG et VG présents sur les deux allocations (même composition matière
      // première commune, ADR 0006 § invariant 5) — mais volumes distincts
      // (quantité propre à chaque allocation) et packaging jamais fusionné.
      const pgOnRef = lineRef.ingredients.find((i) => i.articleId === materialPgId)!;
      const pgOnSecond = lineSecond.ingredients.find((i) => i.articleId === materialPgId)!;
      expect(pgOnRef).toBeTruthy();
      expect(pgOnSecond).toBeTruthy();
      expect(pgOnRef.volumeL).not.toBe(pgOnSecond.volumeL);

      expect(lineRef.ingredients.find((i) => i.articleId === packagingAId)).toBeTruthy();
      expect(lineRef.ingredients.find((i) => i.articleId === packagingBId)).toBeUndefined();
      expect(lineSecond.ingredients.find((i) => i.articleId === packagingBId)).toBeTruthy();
      expect(lineSecond.ingredients.find((i) => i.articleId === packagingAId)).toBeUndefined();
    });

    it('calcule les quantités via le mécanisme existant (computeIngredientQuantities) — volumes PG/VG proportionnels à la quantité de l’allocation', async () => {
      const response = await getPrintData(batchId).expect(200);
      const body = response.body as PrintDataResponseBody;
      const lineRef = body.allocations.find((a) => a.allocationId === allocationRefId)!;
      const pg = lineRef.ingredients.find((i) => i.articleId === materialPgId)!;
      const vg = lineRef.ingredients.find((i) => i.articleId === materialVgId)!;

      // Format 100 ml, 60 % PG / 40 % VG, 300 unités → 18 L / 12 L (voir BatchPreparationService).
      expect(pg.volumeL).toBeCloseTo(18, 6);
      expect(vg.volumeL).toBeCloseTo(12, 6);
      const packaging = lineRef.ingredients.find((i) => i.articleId === packagingAId)!;
      expect(packaging.quantity).toBe(300);
    });

    it('fonctionne alors qu’aucun Lot réel n’existe encore pour ce batch (impression avant clôture)', async () => {
      const lots = await prisma.lot.findMany({ where: { batchId } });
      expect(lots).toHaveLength(0);

      await getPrintData(batchId).expect(200);
    });

    it('appel répété : résultat strictement identique, aucune écriture métier (LotNumberCounter inchangé)', async () => {
      const counterBefore = await getCounter();

      const first = (await getPrintData(batchId).expect(200)).body as PrintDataResponseBody;
      const second = (await getPrintData(batchId).expect(200)).body as PrintDataResponseBody;

      expect(second).toEqual(first);
      expect(await getCounter()).toBe(counterBefore);

      const lots = await prisma.lot.findMany({ where: { batchId } });
      expect(lots).toHaveLength(0);
    });

    it('refuse (404, isolation cross-site) l’accès depuis un autre site — ne révèle pas son existence', async () => {
      await getPrintData(batchId, tokenB).expect(404);
    });
  });

  describe('conditions de refus explicites', () => {
    it('refuse un batch PLANIFIE (jamais lancé)', async () => {
      const batchId = await createBatch(50);
      await getPrintData(batchId).expect(400);
    });

    it('refuse un batch ANNULE', async () => {
      const batchId = await createBatch(50);
      await launchOnly(batchId);
      await request(app.getHttpServer())
        .post(`/production/batches/${batchId}/cancel`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      await getPrintData(batchId).expect(400);
    });

    it('refuse un batch TERMINE (déjà clôturé)', async () => {
      await provisionStock(materialPgId, 100);
      await provisionStock(packagingAId, 1000);
      const batchId = await createBatch(50);
      await advanceToConditionnement(batchId);

      await request(app.getHttpServer())
        .post(`/production/batches/${batchId}/close`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          endedAt: '2026-07-06T16:00:00.000Z',
          producedQuantity: 45,
          rejectedQuantity: 5,
        })
        .expect(200);

      await getPrintData(batchId).expect(400);
    });

    it('refuse un batch EN_COURS legacy sans réservation (repli ADR 0010 § Décision 14)', async () => {
      const legacyBatch = await prisma.batch.create({
        data: {
          siteId: siteAId,
          recipeId: recipeAId,
          machineId,
          format: 100,
          plannedQuantity: 50,
          status: BatchStatus.EN_COURS,
          currentStep: BatchStep.PREPARATION,
          createdByUserId: userAId,
        },
      });
      createdBatchIds.push(legacyBatch.id);

      await getPrintData(legacyBatch.id).expect(400);
    });

    it('retourne 404 pour un batch inexistant', async () => {
      await getPrintData('00000000-0000-0000-0000-000000000000').expect(404);
    });

    it('refuse une requête non authentifiée (401)', async () => {
      await request(app.getHttpServer())
        .get('/production/batches/00000000-0000-0000-0000-000000000000/print-data')
        .expect(401);
    });
  });
});
