import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import * as bcrypt from 'bcryptjs';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { UserRole } from '../generated/prisma/client';

interface LoginResponseBody {
  accessToken: string;
}

/**
 * Vérifie que le module catalog (Article/Machine/Recipe) est bien réservé aux
 * rôles à accès complet — DIRECTION/DAF n'ont aucun accès, pas même en lecture
 * (voir docs/regles-metier.md §1).
 */
describe('Catalog (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const password = 'MotDePasseTest123!';
  const emails = {
    lab: 'e2e-catalog-lab@lca-mes.local',
    direction: 'e2e-catalog-direction@lca-mes.local',
    daf: 'e2e-catalog-daf@lca-mes.local',
  };
  const tokens: Record<'lab' | 'direction' | 'daf', string> = {
    lab: '',
    direction: '',
    daf: '',
  };
  const testOpenSiReferencePrefix = 'E2E-CATALOG-TEST-';

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
    const passwordHash = await bcrypt.hash(password, 4);

    const roleByKey: Record<keyof typeof emails, UserRole> = {
      lab: UserRole.RESPONSABLE_LABORATOIRE,
      direction: UserRole.DIRECTION,
      daf: UserRole.DAF,
    };

    for (const key of Object.keys(emails) as Array<keyof typeof emails>) {
      await prisma.user.upsert({
        where: { email: emails[key] },
        update: { passwordHash, active: true },
        create: {
          siteId: site.id,
          fullName: `Utilisateur Test E2E (${key})`,
          email: emails[key],
          passwordHash,
          role: roleByKey[key],
        },
      });

      const loginResponse = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: emails[key], password });
      tokens[key] = (loginResponse.body as LoginResponseBody).accessToken;
    }
  });

  const testSupplierNamePrefix = 'E2E-CATALOG-TEST-SUPPLIER-';
  const createdSupplierIds: string[] = [];
  const testMarketCodePrefix = 'E2E-CATALOG-TEST-MARKET-';
  const createdMarketIds: string[] = [];
  const testProductFamilyNamePrefix = 'E2E-CATALOG-TEST-FAMILY-';
  const createdProductFamilyIds: string[] = [];

  afterAll(async () => {
    if (prisma) {
      await prisma.article.deleteMany({
        where: { openSiReference: { startsWith: testOpenSiReferencePrefix } },
      });
      if (createdSupplierIds.length > 0) {
        await prisma.supplier.deleteMany({
          where: { id: { in: createdSupplierIds } },
        });
      }
      await prisma.supplier.deleteMany({
        where: { name: { startsWith: testSupplierNamePrefix } },
      });
      if (createdMarketIds.length > 0) {
        await prisma.market.deleteMany({
          where: { id: { in: createdMarketIds } },
        });
      }
      await prisma.market.deleteMany({
        where: { code: { startsWith: testMarketCodePrefix } },
      });
      if (createdProductFamilyIds.length > 0) {
        await prisma.productFamily.deleteMany({
          where: { id: { in: createdProductFamilyIds } },
        });
      }
      await prisma.productFamily.deleteMany({
        where: { name: { startsWith: testProductFamilyNamePrefix } },
      });
      await prisma.user.deleteMany({
        where: { email: { in: Object.values(emails) } },
      });
    }
    if (app) {
      await app.close();
    }
  });

  describe('GET /catalog/articles', () => {
    it('refuse une requête sans token (401)', () => {
      return request(app.getHttpServer()).get('/catalog/articles').expect(401);
    });

    it('autorise RESPONSABLE_LABORATOIRE (200)', () => {
      return request(app.getHttpServer())
        .get('/catalog/articles')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .expect(200);
    });

    it('refuse DIRECTION même en lecture seule (403)', () => {
      return request(app.getHttpServer())
        .get('/catalog/articles')
        .set('Authorization', `Bearer ${tokens.direction}`)
        .expect(403);
    });

    it('refuse DAF même en lecture seule (403)', () => {
      return request(app.getHttpServer())
        .get('/catalog/articles')
        .set('Authorization', `Bearer ${tokens.daf}`)
        .expect(403);
    });
  });

  describe('POST /catalog/articles', () => {
    it('autorise RESPONSABLE_LABORATOIRE à créer un article (201)', () => {
      return request(app.getHttpServer())
        .post('/catalog/articles')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({
          type: 'MATIERE_PREMIERE',
          openSiReference: `${testOpenSiReferencePrefix}MP`,
          name: 'Article de test e2e',
          unitOfMeasure: 'L',
          currentUnitCost: 1,
        })
        .expect(201);
    });

    it('refuse DIRECTION (403)', () => {
      return request(app.getHttpServer())
        .post('/catalog/articles')
        .set('Authorization', `Bearer ${tokens.direction}`)
        .send({
          type: 'MATIERE_PREMIERE',
          openSiReference: `${testOpenSiReferencePrefix}REJECTED`,
          name: 'Ne devrait jamais être créé',
          unitOfMeasure: 'L',
          currentUnitCost: 1,
        })
        .expect(403);
    });

    describe('unité de mesure conditionnelle au type', () => {
      it('refuse une matière première sans unité de mesure (400)', () => {
        return request(app.getHttpServer())
          .post('/catalog/articles')
          .set('Authorization', `Bearer ${tokens.lab}`)
          .send({
            type: 'MATIERE_PREMIERE',
            openSiReference: `${testOpenSiReferencePrefix}MP-SANS-UNITE`,
            name: 'Matière première sans unité',
            currentUnitCost: 1,
          })
          .expect(400);
      });

      it('crée un packaging sans unité de mesure fournie — le serveur y substitue "unité" (201)', async () => {
        const response = await request(app.getHttpServer())
          .post('/catalog/articles')
          .set('Authorization', `Bearer ${tokens.lab}`)
          .send({
            type: 'PACKAGING',
            openSiReference: `${testOpenSiReferencePrefix}PKG-SANS-UNITE`,
            name: 'Packaging sans unité fournie',
            currentUnitCost: 1,
          })
          .expect(201);

        expect((response.body as { unitOfMeasure: string }).unitOfMeasure).toBe('unité');
      });

      it('crée un produit fini sans unité de mesure fournie — le serveur y substitue "unité" (201)', async () => {
        const response = await request(app.getHttpServer())
          .post('/catalog/articles')
          .set('Authorization', `Bearer ${tokens.lab}`)
          .send({
            type: 'PRODUIT_FINI',
            openSiReference: `${testOpenSiReferencePrefix}PF-SANS-UNITE`,
            name: 'Produit fini sans unité fournie',
            currentUnitCost: 1,
          })
          .expect(201);

        expect((response.body as { unitOfMeasure: string }).unitOfMeasure).toBe('unité');
      });

      it('ignore une unité de mesure envoyée malgré tout pour un packaging — toujours remplacée par "unité" (201)', async () => {
        const response = await request(app.getHttpServer())
          .post('/catalog/articles')
          .set('Authorization', `Bearer ${tokens.lab}`)
          .send({
            type: 'PACKAGING',
            openSiReference: `${testOpenSiReferencePrefix}PKG-UNITE-IGNOREE`,
            name: 'Packaging avec unité envoyée à tort',
            unitOfMeasure: 'kg',
            currentUnitCost: 1,
          })
          .expect(201);

        expect((response.body as { unitOfMeasure: string }).unitOfMeasure).toBe('unité');
      });
    });
  });

  describe('PATCH /catalog/articles/:id — changement de type encadré', () => {
    const createdStockLotIds: string[] = [];

    afterAll(async () => {
      if (createdStockLotIds.length > 0) {
        await prisma.stockLot.deleteMany({
          where: { id: { in: createdStockLotIds } },
        });
      }
    });

    it('autorise le changement de type si l’article n’a jamais été utilisé', async () => {
      const createResponse = await request(app.getHttpServer())
        .post('/catalog/articles')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({
          type: 'MATIERE_PREMIERE',
          openSiReference: `${testOpenSiReferencePrefix}UNUSED`,
          name: 'Article inutilisé',
          unitOfMeasure: 'L',
          currentUnitCost: 1,
        })
        .expect(201);
      const articleId = (createResponse.body as { id: string }).id;

      const patchResponse = await request(app.getHttpServer())
        .patch(`/catalog/articles/${articleId}`)
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({ type: 'PACKAGING' })
        .expect(200);

      const patchedBody = patchResponse.body as { type: string; unitOfMeasure: string };
      expect(patchedBody.type).toBe('PACKAGING');
      // Le type bascule vers PACKAGING sans qu'aucune unité ne soit fournie : le
      // serveur force la valeur technique, jamais l'unité matière première héritée.
      expect(patchedBody.unitOfMeasure).toBe('unité');
    });

    it('refuse de faire basculer un article vers MATIERE_PREMIERE sans fournir d’unité de mesure (400)', async () => {
      const createResponse = await request(app.getHttpServer())
        .post('/catalog/articles')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({
          type: 'PACKAGING',
          openSiReference: `${testOpenSiReferencePrefix}PKG-TO-MP-SANS-UNITE`,
          name: 'Packaging jamais utilisé',
          currentUnitCost: 1,
        })
        .expect(201);
      const articleId = (createResponse.body as { id: string }).id;

      await request(app.getHttpServer())
        .patch(`/catalog/articles/${articleId}`)
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({ type: 'MATIERE_PREMIERE' })
        .expect(400);
    });

    it('autorise le basculement vers MATIERE_PREMIERE quand une unité de mesure réelle est fournie (200)', async () => {
      const createResponse = await request(app.getHttpServer())
        .post('/catalog/articles')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({
          type: 'PACKAGING',
          openSiReference: `${testOpenSiReferencePrefix}PKG-TO-MP-AVEC-UNITE`,
          name: 'Packaging jamais utilisé (2)',
          currentUnitCost: 1,
        })
        .expect(201);
      const articleId = (createResponse.body as { id: string }).id;

      const patchResponse = await request(app.getHttpServer())
        .patch(`/catalog/articles/${articleId}`)
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({ type: 'MATIERE_PREMIERE', unitOfMeasure: 'kg' })
        .expect(200);

      const patchedBody = patchResponse.body as { type: string; unitOfMeasure: string };
      expect(patchedBody.type).toBe('MATIERE_PREMIERE');
      expect(patchedBody.unitOfMeasure).toBe('kg');
    });

    it('refuse le changement de type si l’article est déjà utilisé (409, message explicite)', async () => {
      const createResponse = await request(app.getHttpServer())
        .post('/catalog/articles')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({
          type: 'MATIERE_PREMIERE',
          openSiReference: `${testOpenSiReferencePrefix}USED`,
          name: 'Article déjà utilisé',
          unitOfMeasure: 'L',
          currentUnitCost: 1,
        })
        .expect(201);
      const articleId = (createResponse.body as { id: string }).id;

      const site = await prisma.site.findFirstOrThrow();
      const stockLot = await prisma.stockLot.create({
        data: {
          siteId: site.id,
          articleId,
          supplierLotNumber: 'E2E-LOT-TYPE-TEST',
          receivedQuantity: 10,
          remainingQuantity: 10,
          receivedAt: new Date(),
        },
      });
      createdStockLotIds.push(stockLot.id);

      const response = await request(app.getHttpServer())
        .patch(`/catalog/articles/${articleId}`)
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({ type: 'PACKAGING' })
        .expect(409);

      expect((response.body as { message: string }).message).toBe(
        'Le type de cet article ne peut plus être modifié car il est déjà utilisé dans le stock, une recette ou une production. Désactivez cet article et créez-en un nouveau.',
      );
    });
  });

  describe('GET /catalog/suppliers', () => {
    it('refuse une requête sans token (401)', () => {
      return request(app.getHttpServer()).get('/catalog/suppliers').expect(401);
    });

    it('autorise RESPONSABLE_LABORATOIRE (200)', () => {
      return request(app.getHttpServer())
        .get('/catalog/suppliers')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .expect(200);
    });

    it('refuse DIRECTION même en lecture seule (403)', () => {
      return request(app.getHttpServer())
        .get('/catalog/suppliers')
        .set('Authorization', `Bearer ${tokens.direction}`)
        .expect(403);
    });
  });

  describe('POST /catalog/suppliers', () => {
    it('autorise RESPONSABLE_LABORATOIRE à créer un fournisseur (201)', async () => {
      const response = await request(app.getHttpServer())
        .post('/catalog/suppliers')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({
          name: `${testSupplierNamePrefix}Sensient`,
          email: 'contact@sensient.example',
        })
        .expect(201);
      createdSupplierIds.push((response.body as { id: string }).id);
    });

    it('refuse DAF (403)', () => {
      return request(app.getHttpServer())
        .post('/catalog/suppliers')
        .set('Authorization', `Bearer ${tokens.daf}`)
        .send({ name: `${testSupplierNamePrefix}Rejected` })
        .expect(403);
    });
  });

  describe('Fournisseur principal sur une matière première ou un packaging', () => {
    it('autorise l’assignation d’un fournisseur principal valide à une matière première', async () => {
      const supplierResponse = await request(app.getHttpServer())
        .post('/catalog/suppliers')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({ name: `${testSupplierNamePrefix}Valide` })
        .expect(201);
      const supplierId = (supplierResponse.body as { id: string }).id;
      createdSupplierIds.push(supplierId);

      const articleResponse = await request(app.getHttpServer())
        .post('/catalog/articles')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({
          type: 'MATIERE_PREMIERE',
          openSiReference: `${testOpenSiReferencePrefix}SUPPLIER-OK`,
          name: 'Matière première avec fournisseur',
          unitOfMeasure: 'L',
          currentUnitCost: 1,
          supplierId,
        })
        .expect(201);

      expect((articleResponse.body as { supplierId: string }).supplierId).toBe(
        supplierId,
      );
    });

    it('autorise l’assignation d’un fournisseur principal valide à un packaging (retour Kevin)', async () => {
      const supplierResponse = await request(app.getHttpServer())
        .post('/catalog/suppliers')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({ name: `${testSupplierNamePrefix}Packaging` })
        .expect(201);
      const supplierId = (supplierResponse.body as { id: string }).id;
      createdSupplierIds.push(supplierId);

      const articleResponse = await request(app.getHttpServer())
        .post('/catalog/articles')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({
          type: 'PACKAGING',
          openSiReference: `${testOpenSiReferencePrefix}SUPPLIER-PKG-OK`,
          name: 'Packaging avec fournisseur',
          unitOfMeasure: 'unité',
          currentUnitCost: 1,
          supplierId,
        })
        .expect(201);

      expect((articleResponse.body as { supplierId: string }).supplierId).toBe(
        supplierId,
      );
    });

    it('refuse un fournisseur principal sur un article de type produit fini (400)', async () => {
      const supplierResponse = await request(app.getHttpServer())
        .post('/catalog/suppliers')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({ name: `${testSupplierNamePrefix}NonPF` })
        .expect(201);
      const supplierId = (supplierResponse.body as { id: string }).id;
      createdSupplierIds.push(supplierId);

      return request(app.getHttpServer())
        .post('/catalog/articles')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({
          type: 'PRODUIT_FINI',
          openSiReference: `${testOpenSiReferencePrefix}SUPPLIER-PF`,
          name: 'Produit fini ne devrait pas avoir de fournisseur',
          unitOfMeasure: 'unité',
          currentUnitCost: 1,
          supplierId,
        })
        .expect(400);
    });

    it('refuse un fournisseur principal introuvable sur ce site (404)', () => {
      return request(app.getHttpServer())
        .post('/catalog/articles')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({
          type: 'MATIERE_PREMIERE',
          openSiReference: `${testOpenSiReferencePrefix}SUPPLIER-404`,
          name: 'Matière première avec fournisseur inconnu',
          unitOfMeasure: 'L',
          currentUnitCost: 1,
          supplierId: '00000000-0000-0000-0000-000000000000',
        })
        .expect(404);
    });
  });

  describe('Famille commerciale et marché sur un produit fini', () => {
    it('autorise la création avec une famille commerciale seule (sans marché)', async () => {
      const familyResponse = await request(app.getHttpServer())
        .post('/catalog/product-families')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({ name: `${testProductFamilyNamePrefix}ArticleSeule` })
        .expect(201);
      const productFamilyId = (familyResponse.body as { id: string }).id;
      createdProductFamilyIds.push(productFamilyId);

      const articleResponse = await request(app.getHttpServer())
        .post('/catalog/articles')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({
          type: 'PRODUIT_FINI',
          openSiReference: `${testOpenSiReferencePrefix}FAMILY-ONLY`,
          name: 'Recharge avec famille seule',
          unitOfMeasure: 'unité',
          currentUnitCost: 3,
          productFamilyId,
        })
        .expect(201);

      expect(
        (articleResponse.body as { productFamilyId: string }).productFamilyId,
      ).toBe(productFamilyId);
      expect(
        (articleResponse.body as { marketId: string | null }).marketId,
      ).toBeNull();
    });

    it('autorise la création avec une famille commerciale et un marché', async () => {
      const familyResponse = await request(app.getHttpServer())
        .post('/catalog/product-families')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({ name: `${testProductFamilyNamePrefix}ArticleEtMarche` })
        .expect(201);
      const productFamilyId = (familyResponse.body as { id: string }).id;
      createdProductFamilyIds.push(productFamilyId);

      const marketResponse = await request(app.getHttpServer())
        .post('/catalog/markets')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({
          code: `${testMarketCodePrefix}ARTICLE`,
          label: 'Marché article',
        })
        .expect(201);
      const marketId = (marketResponse.body as { id: string }).id;
      createdMarketIds.push(marketId);

      const articleResponse = await request(app.getHttpServer())
        .post('/catalog/articles')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({
          type: 'PRODUIT_FINI',
          openSiReference: `${testOpenSiReferencePrefix}FAMILY-MARKET`,
          name: 'Recharge avec famille et marché',
          unitOfMeasure: 'unité',
          currentUnitCost: 3,
          productFamilyId,
          marketId,
        })
        .expect(201);

      expect(
        (articleResponse.body as { productFamilyId: string }).productFamilyId,
      ).toBe(productFamilyId);
      expect((articleResponse.body as { marketId: string }).marketId).toBe(
        marketId,
      );
    });

    it('met à jour la famille commerciale et le marché d’un article existant', async () => {
      const familyResponse = await request(app.getHttpServer())
        .post('/catalog/product-families')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({ name: `${testProductFamilyNamePrefix}Update` })
        .expect(201);
      const productFamilyId = (familyResponse.body as { id: string }).id;
      createdProductFamilyIds.push(productFamilyId);

      const marketResponse = await request(app.getHttpServer())
        .post('/catalog/markets')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({ code: `${testMarketCodePrefix}UPDATE`, label: 'Marché update' })
        .expect(201);
      const marketId = (marketResponse.body as { id: string }).id;
      createdMarketIds.push(marketId);

      const articleResponse = await request(app.getHttpServer())
        .post('/catalog/articles')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({
          type: 'PRODUIT_FINI',
          openSiReference: `${testOpenSiReferencePrefix}FAMILY-PATCH`,
          name: 'Recharge à mettre à jour',
          unitOfMeasure: 'unité',
          currentUnitCost: 3,
        })
        .expect(201);
      const articleId = (articleResponse.body as { id: string }).id;

      const patchResponse = await request(app.getHttpServer())
        .patch(`/catalog/articles/${articleId}`)
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({ productFamilyId, marketId })
        .expect(200);

      expect(
        (patchResponse.body as { productFamilyId: string }).productFamilyId,
      ).toBe(productFamilyId);
      expect((patchResponse.body as { marketId: string }).marketId).toBe(
        marketId,
      );
    });

    it('refuse une famille commerciale introuvable sur ce site (404)', () => {
      return request(app.getHttpServer())
        .post('/catalog/articles')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({
          type: 'PRODUIT_FINI',
          openSiReference: `${testOpenSiReferencePrefix}FAMILY-404`,
          name: 'Recharge avec famille inconnue',
          unitOfMeasure: 'unité',
          currentUnitCost: 3,
          productFamilyId: '00000000-0000-0000-0000-000000000000',
        })
        .expect(404);
    });

    it('refuse un marché introuvable sur ce site (404)', async () => {
      const familyResponse = await request(app.getHttpServer())
        .post('/catalog/product-families')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({ name: `${testProductFamilyNamePrefix}Market404` })
        .expect(201);
      const productFamilyId = (familyResponse.body as { id: string }).id;
      createdProductFamilyIds.push(productFamilyId);

      return request(app.getHttpServer())
        .post('/catalog/articles')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({
          type: 'PRODUIT_FINI',
          openSiReference: `${testOpenSiReferencePrefix}MARKET-404`,
          name: 'Recharge avec marché inconnu',
          unitOfMeasure: 'unité',
          currentUnitCost: 3,
          productFamilyId,
          marketId: '00000000-0000-0000-0000-000000000000',
        })
        .expect(404);
    });

    it('refuse un marché sans famille commerciale (400)', () => {
      return request(app.getHttpServer())
        .post('/catalog/articles')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({
          type: 'PRODUIT_FINI',
          openSiReference: `${testOpenSiReferencePrefix}MARKET-NO-FAMILY`,
          name: 'Recharge marché sans famille',
          unitOfMeasure: 'unité',
          currentUnitCost: 3,
          marketId: '00000000-0000-0000-0000-000000000000',
        })
        .expect(400);
    });

    it("traite une famille commerciale et un marché d'un autre site comme introuvables (404)", async () => {
      const otherSite = await prisma.site.create({
        data: { name: 'E2E Autre Site — Famille/Marché sur Article' },
      });
      const otherSiteFamily = await prisma.productFamily.create({
        data: { siteId: otherSite.id, name: 'Autre site' },
      });
      const otherSiteMarket = await prisma.market.create({
        data: { siteId: otherSite.id, code: 'OTHER', label: 'Autre site' },
      });

      // Famille valide sur le site courant, pour isoler le rejet du marché
      // d'un autre site (et ne pas mélanger les deux causes de 404).
      const currentSiteFamilyResponse = await request(app.getHttpServer())
        .post('/catalog/product-families')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({ name: `${testProductFamilyNamePrefix}PourMarcheAutreSite` })
        .expect(201);
      const currentSiteFamilyId = (
        currentSiteFamilyResponse.body as { id: string }
      ).id;
      createdProductFamilyIds.push(currentSiteFamilyId);

      await request(app.getHttpServer())
        .post('/catalog/articles')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({
          type: 'PRODUIT_FINI',
          openSiReference: `${testOpenSiReferencePrefix}FAMILY-OTHER-SITE`,
          name: 'Recharge famille autre site',
          unitOfMeasure: 'unité',
          currentUnitCost: 3,
          productFamilyId: otherSiteFamily.id,
        })
        .expect(404);

      await request(app.getHttpServer())
        .post('/catalog/articles')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({
          type: 'PRODUIT_FINI',
          openSiReference: `${testOpenSiReferencePrefix}MARKET-OTHER-SITE`,
          name: 'Recharge marché autre site',
          unitOfMeasure: 'unité',
          currentUnitCost: 3,
          productFamilyId: currentSiteFamilyId,
          marketId: otherSiteMarket.id,
        })
        .expect(404);

      await prisma.market.delete({ where: { id: otherSiteMarket.id } });
      await prisma.productFamily.delete({ where: { id: otherSiteFamily.id } });
      await prisma.site.delete({ where: { id: otherSite.id } });
    });
  });

  describe('GET /catalog/machines', () => {
    it('autorise RESPONSABLE_LABORATOIRE (200)', () => {
      return request(app.getHttpServer())
        .get('/catalog/machines')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .expect(200);
    });

    it('refuse DAF (403)', () => {
      return request(app.getHttpServer())
        .get('/catalog/machines')
        .set('Authorization', `Bearer ${tokens.daf}`)
        .expect(403);
    });
  });

  describe('GET /catalog/markets', () => {
    it('refuse une requête sans token (401)', () => {
      return request(app.getHttpServer()).get('/catalog/markets').expect(401);
    });

    it('autorise RESPONSABLE_LABORATOIRE (200)', () => {
      return request(app.getHttpServer())
        .get('/catalog/markets')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .expect(200);
    });

    it('refuse DIRECTION même en lecture seule (403)', () => {
      return request(app.getHttpServer())
        .get('/catalog/markets')
        .set('Authorization', `Bearer ${tokens.direction}`)
        .expect(403);
    });

    it('refuse DAF même en lecture seule (403)', () => {
      return request(app.getHttpServer())
        .get('/catalog/markets')
        .set('Authorization', `Bearer ${tokens.daf}`)
        .expect(403);
    });
  });

  describe('POST /catalog/markets', () => {
    it('autorise RESPONSABLE_LABORATOIRE à créer un marché (201)', async () => {
      const response = await request(app.getHttpServer())
        .post('/catalog/markets')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({ code: `${testMarketCodePrefix}FR`, label: 'France' })
        .expect(201);
      createdMarketIds.push((response.body as { id: string }).id);
    });

    it('refuse DAF (403)', () => {
      return request(app.getHttpServer())
        .post('/catalog/markets')
        .set('Authorization', `Bearer ${tokens.daf}`)
        .send({ code: `${testMarketCodePrefix}REJECTED`, label: 'Rejeté' })
        .expect(403);
    });
  });

  describe('Marché : mise à jour, désactivation et cloisonnement par site', () => {
    it('met à jour le libellé et le statut actif d’un marché existant', async () => {
      const createResponse = await request(app.getHttpServer())
        .post('/catalog/markets')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({ code: `${testMarketCodePrefix}CH`, label: 'Suisse' })
        .expect(201);
      const marketId = (createResponse.body as { id: string }).id;
      createdMarketIds.push(marketId);

      const patchResponse = await request(app.getHttpServer())
        .patch(`/catalog/markets/${marketId}`)
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({ label: 'Confédération suisse', active: false })
        .expect(200);

      expect((patchResponse.body as { label: string }).label).toBe(
        'Confédération suisse',
      );
      expect((patchResponse.body as { active: boolean }).active).toBe(false);
    });

    it('désactive un marché sans le supprimer physiquement (DELETE)', async () => {
      const createResponse = await request(app.getHttpServer())
        .post('/catalog/markets')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({
          code: `${testMarketCodePrefix}DEACTIVATE`,
          label: 'À désactiver',
        })
        .expect(201);
      const marketId = (createResponse.body as { id: string }).id;
      createdMarketIds.push(marketId);

      const deleteResponse = await request(app.getHttpServer())
        .delete(`/catalog/markets/${marketId}`)
        .set('Authorization', `Bearer ${tokens.lab}`)
        .expect(200);
      expect((deleteResponse.body as { active: boolean }).active).toBe(false);

      const getResponse = await request(app.getHttpServer())
        .get(`/catalog/markets/${marketId}`)
        .set('Authorization', `Bearer ${tokens.lab}`)
        .expect(200);
      expect((getResponse.body as { id: string }).id).toBe(marketId);
    });

    it("traite un marché d'un autre site comme introuvable (404), sans révéler son existence", async () => {
      const otherSite = await prisma.site.create({
        data: { name: 'E2E Autre Site — Marchés' },
      });
      const otherSiteMarket = await prisma.market.create({
        data: { siteId: otherSite.id, code: 'OTHER-SITE', label: 'Autre site' },
      });

      await request(app.getHttpServer())
        .get(`/catalog/markets/${otherSiteMarket.id}`)
        .set('Authorization', `Bearer ${tokens.lab}`)
        .expect(404);

      await request(app.getHttpServer())
        .patch(`/catalog/markets/${otherSiteMarket.id}`)
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({ label: 'Ne devrait jamais être appliqué' })
        .expect(404);

      await prisma.market.delete({ where: { id: otherSiteMarket.id } });
      await prisma.site.delete({ where: { id: otherSite.id } });
    });
  });

  describe('GET /catalog/product-families', () => {
    it('refuse une requête sans token (401)', () => {
      return request(app.getHttpServer())
        .get('/catalog/product-families')
        .expect(401);
    });

    it('autorise RESPONSABLE_LABORATOIRE (200)', () => {
      return request(app.getHttpServer())
        .get('/catalog/product-families')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .expect(200);
    });

    it('refuse DIRECTION même en lecture seule (403)', () => {
      return request(app.getHttpServer())
        .get('/catalog/product-families')
        .set('Authorization', `Bearer ${tokens.direction}`)
        .expect(403);
    });

    it('refuse DAF même en lecture seule (403)', () => {
      return request(app.getHttpServer())
        .get('/catalog/product-families')
        .set('Authorization', `Bearer ${tokens.daf}`)
        .expect(403);
    });
  });

  describe('POST /catalog/product-families', () => {
    it('autorise RESPONSABLE_LABORATOIRE à créer une famille commerciale (201)', async () => {
      const response = await request(app.getHttpServer())
        .post('/catalog/product-families')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({ name: `${testProductFamilyNamePrefix}Lavande` })
        .expect(201);
      createdProductFamilyIds.push((response.body as { id: string }).id);
    });

    it('refuse DAF (403)', () => {
      return request(app.getHttpServer())
        .post('/catalog/product-families')
        .set('Authorization', `Bearer ${tokens.daf}`)
        .send({ name: `${testProductFamilyNamePrefix}Rejected` })
        .expect(403);
    });
  });

  describe('Famille commerciale : mise à jour, désactivation et cloisonnement par site', () => {
    it('met à jour le nom et le statut actif d’une famille commerciale existante', async () => {
      const createResponse = await request(app.getHttpServer())
        .post('/catalog/product-families')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({ name: `${testProductFamilyNamePrefix}Menthe` })
        .expect(201);
      const productFamilyId = (createResponse.body as { id: string }).id;
      createdProductFamilyIds.push(productFamilyId);

      const patchResponse = await request(app.getHttpServer())
        .patch(`/catalog/product-families/${productFamilyId}`)
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({
          name: `${testProductFamilyNamePrefix}Menthe Glaciale`,
          active: false,
        })
        .expect(200);

      expect((patchResponse.body as { name: string }).name).toBe(
        `${testProductFamilyNamePrefix}Menthe Glaciale`,
      );
      expect((patchResponse.body as { active: boolean }).active).toBe(false);
    });

    it('désactive une famille commerciale sans la supprimer physiquement (DELETE)', async () => {
      const createResponse = await request(app.getHttpServer())
        .post('/catalog/product-families')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({ name: `${testProductFamilyNamePrefix}ADesactiver` })
        .expect(201);
      const productFamilyId = (createResponse.body as { id: string }).id;
      createdProductFamilyIds.push(productFamilyId);

      const deleteResponse = await request(app.getHttpServer())
        .delete(`/catalog/product-families/${productFamilyId}`)
        .set('Authorization', `Bearer ${tokens.lab}`)
        .expect(200);
      expect((deleteResponse.body as { active: boolean }).active).toBe(false);

      const getResponse = await request(app.getHttpServer())
        .get(`/catalog/product-families/${productFamilyId}`)
        .set('Authorization', `Bearer ${tokens.lab}`)
        .expect(200);
      expect((getResponse.body as { id: string }).id).toBe(productFamilyId);
    });

    it("traite une famille commerciale d'un autre site comme introuvable (404), sans révéler son existence", async () => {
      const otherSite = await prisma.site.create({
        data: { name: 'E2E Autre Site — Familles commerciales' },
      });
      const otherSiteProductFamily = await prisma.productFamily.create({
        data: { siteId: otherSite.id, name: 'Autre site' },
      });

      await request(app.getHttpServer())
        .get(`/catalog/product-families/${otherSiteProductFamily.id}`)
        .set('Authorization', `Bearer ${tokens.lab}`)
        .expect(404);

      await request(app.getHttpServer())
        .patch(`/catalog/product-families/${otherSiteProductFamily.id}`)
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({ name: 'Ne devrait jamais être appliqué' })
        .expect(404);

      await prisma.productFamily.delete({
        where: { id: otherSiteProductFamily.id },
      });
      await prisma.site.delete({ where: { id: otherSite.id } });
    });
  });

  describe('GET /catalog/recipes', () => {
    it('autorise RESPONSABLE_LABORATOIRE (200)', () => {
      return request(app.getHttpServer())
        .get('/catalog/recipes')
        .query({ finishedProductId: '00000000-0000-0000-0000-000000000000' })
        .set('Authorization', `Bearer ${tokens.lab}`)
        .expect(200);
    });

    it('refuse DIRECTION avant même la validation des paramètres (403, pas 400)', () => {
      return request(app.getHttpServer())
        .get('/catalog/recipes')
        .set('Authorization', `Bearer ${tokens.direction}`)
        .expect(403);
    });
  });
});
