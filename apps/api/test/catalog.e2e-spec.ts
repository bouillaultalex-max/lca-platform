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

      expect((patchResponse.body as { type: string }).type).toBe('PACKAGING');
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
