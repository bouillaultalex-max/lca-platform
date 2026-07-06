import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import * as bcrypt from 'bcryptjs';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ArticleType, UserRole } from '../generated/prisma/client';

interface LoginResponseBody {
  accessToken: string;
}

interface StockLotResponseBody {
  id: string;
}

/**
 * Vérifie le contrôle d'accès du module stock : la consultation (GET) est ouverte
 * à tout utilisateur authentifié y compris DIRECTION/DAF, mais l'écriture (réception,
 * ajustement) reste réservée aux rôles à accès complet — voir docs/regles-metier.md §1.
 */
describe('Stock (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let testArticleId: string;
  let testStockLotId: string;

  const password = 'MotDePasseTest123!';
  const emails = {
    lab: 'e2e-stock-lab@lca-mes.local',
    direction: 'e2e-stock-direction@lca-mes.local',
    daf: 'e2e-stock-daf@lca-mes.local',
  };
  const tokens: Record<'lab' | 'direction' | 'daf', string> = {
    lab: '',
    direction: '',
    daf: '',
  };
  const testOpenSiReference = 'E2E-STOCK-TEST-MP';

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

    const article = await prisma.article.upsert({
      where: {
        siteId_openSiReference: {
          siteId: site.id,
          openSiReference: testOpenSiReference,
        },
      },
      update: {},
      create: {
        siteId: site.id,
        type: ArticleType.MATIERE_PREMIERE,
        openSiReference: testOpenSiReference,
        name: 'Article de test e2e (stock)',
        unitOfMeasure: 'L',
        currentUnitCost: 1,
      },
    });
    testArticleId = article.id;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.stockMovement.deleteMany({
        where: { articleId: testArticleId },
      });
      await prisma.stockItem.deleteMany({
        where: { articleId: testArticleId },
      });
      await prisma.stockLot.deleteMany({ where: { articleId: testArticleId } });
      await prisma.article.deleteMany({ where: { id: testArticleId } });
      await prisma.user.deleteMany({
        where: { email: { in: Object.values(emails) } },
      });
    }
    if (app) {
      await app.close();
    }
  });

  describe('POST /stock/lots (réception)', () => {
    it('refuse une requête sans token (401)', () => {
      return request(app.getHttpServer()).post('/stock/lots').expect(401);
    });

    it('autorise RESPONSABLE_LABORATOIRE à réceptionner un lot (201)', async () => {
      const response = await request(app.getHttpServer())
        .post('/stock/lots')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({
          articleId: testArticleId,
          supplierLotNumber: 'E2E-LOT-001',
          receivedQuantity: 100,
          receivedAt: '2026-07-06',
        })
        .expect(201);

      testStockLotId = (response.body as StockLotResponseBody).id;
    });

    it('refuse DIRECTION (403)', () => {
      return request(app.getHttpServer())
        .post('/stock/lots')
        .set('Authorization', `Bearer ${tokens.direction}`)
        .send({
          articleId: testArticleId,
          supplierLotNumber: 'E2E-LOT-REJECTED',
          receivedQuantity: 100,
          receivedAt: '2026-07-06',
        })
        .expect(403);
    });

    it('refuse DAF (403)', () => {
      return request(app.getHttpServer())
        .post('/stock/lots')
        .set('Authorization', `Bearer ${tokens.daf}`)
        .send({
          articleId: testArticleId,
          supplierLotNumber: 'E2E-LOT-REJECTED',
          receivedQuantity: 100,
          receivedAt: '2026-07-06',
        })
        .expect(403);
    });
  });

  describe('GET /stock/items (consultation)', () => {
    it('refuse une requête sans token (401)', () => {
      return request(app.getHttpServer()).get('/stock/items').expect(401);
    });

    it('autorise RESPONSABLE_LABORATOIRE (200)', () => {
      return request(app.getHttpServer())
        .get('/stock/items')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .expect(200);
    });

    it('autorise DIRECTION en lecture (200) — contrairement au module catalog', () => {
      return request(app.getHttpServer())
        .get('/stock/items')
        .set('Authorization', `Bearer ${tokens.direction}`)
        .expect(200);
    });

    it('autorise DAF en lecture (200)', () => {
      return request(app.getHttpServer())
        .get('/stock/items')
        .set('Authorization', `Bearer ${tokens.daf}`)
        .expect(200);
    });

    it('calcule un équivalent cartons cohérent pour un article configuré', async () => {
      const response = await request(app.getHttpServer())
        .get(`/stock/items/${testArticleId}`)
        .set('Authorization', `Bearer ${tokens.lab}`)
        .expect(200);

      expect(
        (response.body as { availableQuantity: string }).availableQuantity,
      ).toBe('100');
    });
  });

  describe('GET /stock/lots (détail par article)', () => {
    it('refuse un appel sans articleId (400)', () => {
      return request(app.getHttpServer())
        .get('/stock/lots')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .expect(400);
    });

    it('autorise DIRECTION en lecture (200)', () => {
      return request(app.getHttpServer())
        .get('/stock/lots')
        .query({ articleId: testArticleId })
        .set('Authorization', `Bearer ${tokens.direction}`)
        .expect(200);
    });
  });

  describe('POST /stock/lots/:id/adjustments (ajustement)', () => {
    it('autorise RESPONSABLE_LABORATOIRE et journalise un StockMovement (200)', async () => {
      await request(app.getHttpServer())
        .post(`/stock/lots/${testStockLotId}/adjustments`)
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({ countedQuantity: 90, comment: 'Écart e2e' })
        .expect(200);

      const movements = await prisma.stockMovement.findMany({
        where: { stockLotId: testStockLotId },
      });
      expect(movements.some((m) => m.type === 'AJUSTEMENT_INVENTAIRE')).toBe(
        true,
      );
    });

    it('refuse DIRECTION (403)', () => {
      return request(app.getHttpServer())
        .post(`/stock/lots/${testStockLotId}/adjustments`)
        .set('Authorization', `Bearer ${tokens.direction}`)
        .send({ countedQuantity: 50 })
        .expect(403);
    });
  });
});
