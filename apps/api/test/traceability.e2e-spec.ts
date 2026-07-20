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
  LotQualityStatus,
  RecipeStatus,
  UserRole,
} from '../generated/prisma/client';

interface LoginResponseBody {
  accessToken: string;
}

interface LotTraceabilityResponseBody {
  id: string;
  lotNumber: string;
  quantity: number;
  qualityStatus: string;
  manufacturedAt: string;
  expiryDate: string | null;
  batch: {
    id: string;
    status: string;
    recipe: {
      id: string;
      format: number;
      finishedProduct: { id: string; name: string };
    };
  };
  genealogyLines: Array<{
    id: string;
    consumedQuantity: string;
    consumedArticle: { id: string; name: string };
    consumedStockLot: { id: string; supplierLotNumber: string };
  }>;
}

interface StockLotTraceabilityResponseBody {
  id: string;
  supplierLotNumber: string;
  genealogyLines: Array<{
    id: string;
    lot: { id: string; lotNumber: string };
  }>;
}

/**
 * Couverture e2e des endpoints en lecture du module `traceability` (voir TRAC-04,
 * TRAC-03A, PROJECT_STATE.md §8) : aucun endpoint d'écriture n'existe dans ce module,
 * les données (Lot/LotGenealogy/StockLot) sont donc créées directement via Prisma,
 * comme le fait déjà stock.e2e-spec.ts pour StockLot — passer par le workflow complet
 * de clôture de batch (4 x advance-step + close) n'apporterait rien à la vérification
 * de ces endpoints en lecture seule et alourdirait le jeu de données sans le
 * rendre plus représentatif.
 *
 * Deux sites distincts sont créés pour vérifier l'isolation (voir docs/regles-metier.md
 * §1) : aucune autre suite e2e du projet n'a besoin de deux sites, ces deux-là sont
 * donc créés puis nettoyés intégralement par cette suite, sans réutiliser le site
 * partagé par les autres specs (`site.findFirst() ?? create`).
 */
describe('Traceability (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  let siteAId: string;
  let siteBId: string;
  let tokenA: string;
  let tokenB: string;

  let materialAId: string;
  let lotA1Id: string;
  let lotA1Number: string;
  let lotA2Id: string;
  let lotB1Id: string;
  let lotB1Number: string;
  let stockLotA1Id: string; // consommé par lotA1 ET lotA2 (cas "plusieurs lots consommateurs")
  let stockLotA2UnconsumedId: string; // reçu mais jamais consommé (cas "aucun lot consommateur")
  let stockLotB1Id: string;

  const password = 'MotDePasseTest123!';
  const emails = {
    a: 'e2e-traceability-a@lca-mes.local',
    b: 'e2e-traceability-b@lca-mes.local',
  };

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
      data: { name: 'Site e2e traçabilité A' },
    });
    const siteB = await prisma.site.create({
      data: { name: 'Site e2e traçabilité B' },
    });
    siteAId = siteA.id;
    siteBId = siteB.id;

    const passwordHash = await bcrypt.hash(password, 4);
    // `upsert` (comme dans stock.e2e-spec.ts/production.e2e-spec.ts) plutôt que `create` :
    // `email` est unique globalement, donc un run précédent interrompu avant son `afterAll`
    // (crash, arrêt forcé) laisserait cet e-mail déjà pris et ferait échouer un `create` au
    // relancement. `siteId` est explicitement réécrit dans la branche `update` : ce test crée
    // un site neuf à chaque exécution (nécessaire à l'isolation testée plus bas), un
    // utilisateur résiduel d'un run précédent doit donc être rattaché au site de CE run, pas
    // laissé sur l'ancien site orphelin.
    await prisma.user.upsert({
      where: { email: emails.a },
      update: { passwordHash, active: true, siteId: siteAId },
      create: {
        siteId: siteAId,
        fullName: 'Utilisateur Test E2E (traceability A)',
        email: emails.a,
        passwordHash,
        role: UserRole.RESPONSABLE_LABORATOIRE,
      },
    });
    await prisma.user.upsert({
      where: { email: emails.b },
      update: { passwordHash, active: true, siteId: siteBId },
      create: {
        siteId: siteBId,
        fullName: 'Utilisateur Test E2E (traceability B)',
        email: emails.b,
        passwordHash,
        role: UserRole.RESPONSABLE_LABORATOIRE,
      },
    });

    const loginA = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: emails.a, password });
    tokenA = (loginA.body as LoginResponseBody).accessToken;
    const loginB = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: emails.b, password });
    tokenB = (loginB.body as LoginResponseBody).accessToken;

    // --- Site A : article, recette, machine, deux batches clôturés ---
    const materialA = await prisma.article.create({
      data: {
        siteId: siteAId,
        type: ArticleType.MATIERE_PREMIERE,
        openSiReference: 'E2E-TRAC-A-MP',
        name: 'Huile essentielle test e2e (traçabilité A)',
        unitOfMeasure: 'L',
        currentUnitCost: 1,
      },
    });
    materialAId = materialA.id;
    const finishedA = await prisma.article.create({
      data: {
        siteId: siteAId,
        type: ArticleType.PRODUIT_FINI,
        openSiReference: 'E2E-TRAC-A-FP',
        name: 'Recharge test e2e (traçabilité A)',
        unitOfMeasure: 'unité',
        currentUnitCost: 1,
      },
    });
    const recipeA = await prisma.recipe.create({
      data: {
        siteId: siteAId,
        finishedProductId: finishedA.id,
        format: 100,
        version: 1,
        status: RecipeStatus.ACTIVE,
      },
    });
    const machineA = await prisma.machine.create({
      data: {
        siteId: siteAId,
        name: 'Machine test e2e (traçabilité A)',
        supportedFormats: [100],
        active: true,
      },
    });
    const userA = await prisma.user.findUniqueOrThrow({
      where: { email: emails.a },
    });

    async function createClosedBatch(
      siteId: string,
      recipeId: string,
      machineId: string,
      createdByUserId: string,
      plannedQuantity: number,
    ) {
      return prisma.batch.create({
        data: {
          siteId,
          recipeId,
          machineId,
          format: 100,
          plannedQuantity,
          producedQuantity: plannedQuantity,
          rejectedQuantity: 0,
          status: BatchStatus.TERMINE,
          currentStep: BatchStep.CONDITIONNEMENT,
          createdByUserId,
          startedAt: new Date('2026-07-18T08:00:00.000Z'),
          endedAt: new Date('2026-07-18T16:00:00.000Z'),
        },
      });
    }

    const batchA1 = await createClosedBatch(
      siteAId,
      recipeA.id,
      machineA.id,
      userA.id,
      500,
    );
    const batchA2 = await createClosedBatch(
      siteAId,
      recipeA.id,
      machineA.id,
      userA.id,
      300,
    );

    const stockLotA1 = await prisma.stockLot.create({
      data: {
        siteId: siteAId,
        articleId: materialAId,
        supplierLotNumber: 'FOURNISSEUR-E2E-TRAC-A1',
        receivedQuantity: 100,
        remainingQuantity: 40,
        receivedAt: new Date('2026-07-15T09:00:00.000Z'),
      },
    });
    stockLotA1Id = stockLotA1.id;
    const stockLotA2Unconsumed = await prisma.stockLot.create({
      data: {
        siteId: siteAId,
        articleId: materialAId,
        supplierLotNumber: 'FOURNISSEUR-E2E-TRAC-A2-NON-CONSOMME',
        receivedQuantity: 50,
        remainingQuantity: 50,
        receivedAt: new Date('2026-07-16T09:00:00.000Z'),
      },
    });
    stockLotA2UnconsumedId = stockLotA2Unconsumed.id;

    const lotA1 = await prisma.lot.create({
      data: {
        siteId: siteAId,
        batchId: batchA1.id,
        lotNumber: `E2E-TRAC-${Date.now()}-A1`,
        quantity: 500,
        manufacturedAt: new Date('2026-07-18T16:00:00.000Z'),
        expiryDate: new Date('2028-07-18T00:00:00.000Z'),
        qualityStatus: LotQualityStatus.CONFORME,
      },
    });
    lotA1Id = lotA1.id;
    lotA1Number = lotA1.lotNumber;
    const lotA2 = await prisma.lot.create({
      data: {
        siteId: siteAId,
        batchId: batchA2.id,
        lotNumber: `E2E-TRAC-${Date.now()}-A2`,
        quantity: 300,
        manufacturedAt: new Date('2026-07-18T16:00:00.000Z'),
        qualityStatus: LotQualityStatus.EN_ATTENTE,
      },
    });
    lotA2Id = lotA2.id;

    // stockLotA1 est consommé par les DEUX lots de production (cas "plusieurs
    // lots consommateurs") ; stockLotA2Unconsumed n'est référencé par aucune
    // ligne de généalogie (cas "aucun lot consommateur").
    await prisma.lotGenealogy.create({
      data: {
        lotId: lotA1.id,
        consumedArticleId: materialAId,
        consumedStockLotId: stockLotA1.id,
        consumedQuantity: 30,
      },
    });
    await prisma.lotGenealogy.create({
      data: {
        lotId: lotA2.id,
        consumedArticleId: materialAId,
        consumedStockLotId: stockLotA1.id,
        consumedQuantity: 30,
      },
    });

    // --- Site B : jeu de données minimal, pour les vérifications d'isolation ---
    const materialB = await prisma.article.create({
      data: {
        siteId: siteBId,
        type: ArticleType.MATIERE_PREMIERE,
        openSiReference: 'E2E-TRAC-B-MP',
        name: 'Huile essentielle test e2e (traçabilité B)',
        unitOfMeasure: 'L',
        currentUnitCost: 1,
      },
    });
    const finishedB = await prisma.article.create({
      data: {
        siteId: siteBId,
        type: ArticleType.PRODUIT_FINI,
        openSiReference: 'E2E-TRAC-B-FP',
        name: 'Recharge test e2e (traçabilité B)',
        unitOfMeasure: 'unité',
        currentUnitCost: 1,
      },
    });
    const recipeB = await prisma.recipe.create({
      data: {
        siteId: siteBId,
        finishedProductId: finishedB.id,
        format: 100,
        version: 1,
        status: RecipeStatus.ACTIVE,
      },
    });
    const machineB = await prisma.machine.create({
      data: {
        siteId: siteBId,
        name: 'Machine test e2e (traçabilité B)',
        supportedFormats: [100],
        active: true,
      },
    });
    const userB = await prisma.user.findUniqueOrThrow({
      where: { email: emails.b },
    });
    const batchB1 = await createClosedBatch(
      siteBId,
      recipeB.id,
      machineB.id,
      userB.id,
      200,
    );
    const stockLotB1 = await prisma.stockLot.create({
      data: {
        siteId: siteBId,
        articleId: materialB.id,
        supplierLotNumber: 'FOURNISSEUR-E2E-TRAC-B1',
        receivedQuantity: 60,
        remainingQuantity: 20,
        receivedAt: new Date('2026-07-15T09:00:00.000Z'),
      },
    });
    stockLotB1Id = stockLotB1.id;
    const lotB1 = await prisma.lot.create({
      data: {
        siteId: siteBId,
        batchId: batchB1.id,
        lotNumber: `E2E-TRAC-${Date.now()}-B1`,
        quantity: 200,
        manufacturedAt: new Date('2026-07-18T16:00:00.000Z'),
        qualityStatus: LotQualityStatus.CONFORME,
      },
    });
    lotB1Id = lotB1.id;
    lotB1Number = lotB1.lotNumber;
    await prisma.lotGenealogy.create({
      data: {
        lotId: lotB1.id,
        consumedArticleId: materialB.id,
        consumedStockLotId: stockLotB1.id,
        consumedQuantity: 15,
      },
    });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.lotGenealogy.deleteMany({
        where: { lotId: { in: [lotA1Id, lotA2Id, lotB1Id] } },
      });
      await prisma.lot.deleteMany({
        where: { id: { in: [lotA1Id, lotA2Id, lotB1Id] } },
      });
      await prisma.batch.deleteMany({
        where: { siteId: { in: [siteAId, siteBId] } },
      });
      await prisma.stockLot.deleteMany({
        where: { siteId: { in: [siteAId, siteBId] } },
      });
      await prisma.recipeLine.deleteMany({
        where: { recipe: { siteId: { in: [siteAId, siteBId] } } },
      });
      await prisma.recipe.deleteMany({
        where: { siteId: { in: [siteAId, siteBId] } },
      });
      await prisma.machine.deleteMany({
        where: { siteId: { in: [siteAId, siteBId] } },
      });
      await prisma.article.deleteMany({
        where: { siteId: { in: [siteAId, siteBId] } },
      });
      await prisma.user.deleteMany({
        where: { email: { in: Object.values(emails) } },
      });
      await prisma.site.deleteMany({
        where: { id: { in: [siteAId, siteBId] } },
      });
    }
    if (app) {
      await app.close();
    }
  });

  describe('GET /traceability/lots/:id', () => {
    it('retourne la généalogie complète d’un lot du site courant (200)', async () => {
      const response = await request(app.getHttpServer())
        .get(`/traceability/lots/${lotA1Id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      const body = response.body as LotTraceabilityResponseBody;
      expect(body.id).toBe(lotA1Id);
      expect(body.quantity).toBe(500);
      expect(body.qualityStatus).toBe(LotQualityStatus.CONFORME);
      expect(body.manufacturedAt).toBeTruthy();
      expect(body.expiryDate).toBeTruthy();
      expect(body.batch).toMatchObject({ status: BatchStatus.TERMINE });
      expect(body.batch.recipe.format).toBe(100);
      expect(body.batch.recipe.finishedProduct.name).toBe(
        'Recharge test e2e (traçabilité A)',
      );

      expect(body.genealogyLines).toHaveLength(1);
      expect(body.genealogyLines[0]).toMatchObject({
        consumedQuantity: '30',
        consumedArticle: {
          id: materialAId,
          name: 'Huile essentielle test e2e (traçabilité A)',
        },
        consumedStockLot: {
          id: stockLotA1Id,
          supplierLotNumber: 'FOURNISSEUR-E2E-TRAC-A1',
        },
      });
    });

    it('reste correct pour un lot sans date de péremption (champ optionnel absent)', async () => {
      const response = await request(app.getHttpServer())
        .get(`/traceability/lots/${lotA2Id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      const body = response.body as LotTraceabilityResponseBody;
      expect(body.expiryDate).toBeNull();
      expect(body.qualityStatus).toBe(LotQualityStatus.EN_ATTENTE);
    });

    it('retourne 404 pour un UUID inexistant', () => {
      return request(app.getHttpServer())
        .get('/traceability/lots/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(404);
    });

    it('retourne 404 (pas 403) pour un lot appartenant à un autre site — ne révèle pas son existence', () => {
      return request(app.getHttpServer())
        .get(`/traceability/lots/${lotB1Id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(404);
    });

    it('contrôle : ce même lot reste bien accessible à un utilisateur de son propre site (200)', async () => {
      const response = await request(app.getHttpServer())
        .get(`/traceability/lots/${lotB1Id}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);

      expect((response.body as LotTraceabilityResponseBody).id).toBe(lotB1Id);
    });

    it('refuse une requête non authentifiée (401)', () => {
      return request(app.getHttpServer())
        .get(`/traceability/lots/${lotA1Id}`)
        .expect(401);
    });
  });

  describe('GET /traceability/lots?lotNumber= (recherche par numéro de lot — TRAC-03A)', () => {
    it('retourne la même généalogie complète que la recherche par identifiant technique (200)', async () => {
      const response = await request(app.getHttpServer())
        .get('/traceability/lots')
        .query({ lotNumber: lotA1Number })
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      const body = response.body as LotTraceabilityResponseBody;
      expect(body.id).toBe(lotA1Id);
      expect(body.lotNumber).toBe(lotA1Number);
      expect(body.genealogyLines).toHaveLength(1);
    });

    it('retourne 404 pour un numéro de lot inexistant', () => {
      return request(app.getHttpServer())
        .get('/traceability/lots')
        .query({ lotNumber: '999999-INEXISTANT' })
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(404);
    });

    it('retourne 404 (pas 403) pour un numéro de lot appartenant à un autre site — ne révèle pas son existence', () => {
      return request(app.getHttpServer())
        .get('/traceability/lots')
        .query({ lotNumber: lotB1Number })
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(404);
    });

    it('contrôle : ce même numéro reste bien accessible à un utilisateur de son propre site (200)', async () => {
      const response = await request(app.getHttpServer())
        .get('/traceability/lots')
        .query({ lotNumber: lotB1Number })
        .set('Authorization', `Bearer ${tokenB}`)
        .expect(200);

      expect((response.body as LotTraceabilityResponseBody).id).toBe(lotB1Id);
    });

    it('refuse un appel sans le paramètre lotNumber (400)', () => {
      return request(app.getHttpServer())
        .get('/traceability/lots')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(400);
    });

    it('refuse une requête non authentifiée (401)', () => {
      return request(app.getHttpServer())
        .get('/traceability/lots')
        .query({ lotNumber: lotA1Number })
        .expect(401);
    });
  });

  describe('GET /traceability/stock-lots/:id', () => {
    it('retourne tous les lots de production du site ayant consommé ce StockLot (plusieurs consommateurs)', async () => {
      const response = await request(app.getHttpServer())
        .get(`/traceability/stock-lots/${stockLotA1Id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      const body = response.body as StockLotTraceabilityResponseBody;
      expect(body.id).toBe(stockLotA1Id);
      expect(body.supplierLotNumber).toBe('FOURNISSEUR-E2E-TRAC-A1');

      // Assertion indépendante de l'ordre : on compare l'ensemble des identifiants
      // de lot, pas une position précise dans le tableau.
      const consumingLotIds = body.genealogyLines
        .map((line) => line.lot.id)
        .sort();
      expect(consumingLotIds).toEqual([lotA1Id, lotA2Id].sort());
    });

    it('retourne une collection de généalogie vide (200) — jamais 404 — quand le StockLot existe mais n’a été consommé par aucun lot', async () => {
      const response = await request(app.getHttpServer())
        .get(`/traceability/stock-lots/${stockLotA2UnconsumedId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      const body = response.body as StockLotTraceabilityResponseBody;
      expect(body.id).toBe(stockLotA2UnconsumedId);
      expect(body.genealogyLines).toEqual([]);
    });

    it('ne retourne aucun lot de production appartenant à un autre site', async () => {
      const response = await request(app.getHttpServer())
        .get(`/traceability/stock-lots/${stockLotA1Id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(200);

      const body = response.body as StockLotTraceabilityResponseBody;
      const consumingLotIds = body.genealogyLines.map((line) => line.lot.id);
      expect(consumingLotIds).not.toContain(lotB1Id);
    });

    it('retourne 404 pour un StockLot appartenant à un autre site', () => {
      return request(app.getHttpServer())
        .get(`/traceability/stock-lots/${stockLotB1Id}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(404);
    });

    it('retourne 404 pour un UUID inexistant', () => {
      return request(app.getHttpServer())
        .get('/traceability/stock-lots/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${tokenA}`)
        .expect(404);
    });

    it('refuse une requête non authentifiée (401)', () => {
      return request(app.getHttpServer())
        .get(`/traceability/stock-lots/${stockLotA1Id}`)
        .expect(401);
    });
  });
});
