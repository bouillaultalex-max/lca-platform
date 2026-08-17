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
  UserRole,
} from '../generated/prisma/client';

interface LoginResponseBody {
  accessToken: string;
}

interface BatchCostResponseBody {
  id: string;
  lotId: string;
  batchId: string;
  materialCostTotal: string;
  packagingCostTotal: string;
  unitCostPerFlacon: string;
  producedQuantityTotal: number;
}

/**
 * Couverture e2e du module `costing` en lecture seule (PRD-10, voir ADR 0007) :
 * consultation ouverte à tout utilisateur authentifié y compris DIRECTION/DAF (comme
 * traceability/stock, voir docs/regles-metier.md §1), cloisonnement par site via
 * `Lot.siteId` (`BatchCost` n'a pas de `siteId` propre), aucune route d'écriture.
 *
 * `BatchCost` est créé directement via Prisma (comme `Lot`/`LotGenealogy` dans
 * traceability.e2e-spec.ts) plutôt qu'en rejouant tout le workflow de clôture : ce
 * dernier est déjà couvert par batch-closure.service.spec.ts, ce test ne vérifie que
 * l'endpoint de lecture lui-même.
 */
describe('Costing (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  let siteAId: string;
  let siteBId: string;

  let lotAId: string;
  let batchAId: string;
  let lotBId: string;

  const password = 'MotDePasseTest123!';
  const emails = {
    lab: 'e2e-costing-lab@lca-mes.local',
    direction: 'e2e-costing-direction@lca-mes.local',
    daf: 'e2e-costing-daf@lca-mes.local',
    siteB: 'e2e-costing-siteb@lca-mes.local',
  };
  const tokens: Record<keyof typeof emails, string> = {
    lab: '',
    direction: '',
    daf: '',
    siteB: '',
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
      data: { name: 'Site e2e costing A' },
    });
    const siteB = await prisma.site.create({
      data: { name: 'Site e2e costing B' },
    });
    siteAId = siteA.id;
    siteBId = siteB.id;

    const passwordHash = await bcrypt.hash(password, 4);
    const roleByKey: Record<keyof typeof emails, UserRole> = {
      lab: UserRole.RESPONSABLE_LABORATOIRE,
      direction: UserRole.DIRECTION,
      daf: UserRole.DAF,
      siteB: UserRole.RESPONSABLE_LABORATOIRE,
    };
    const siteByKey: Record<keyof typeof emails, string> = {
      lab: siteAId,
      direction: siteAId,
      daf: siteAId,
      siteB: siteBId,
    };

    for (const key of Object.keys(emails) as Array<keyof typeof emails>) {
      await prisma.user.upsert({
        where: { email: emails[key] },
        update: { passwordHash, active: true, siteId: siteByKey[key] },
        create: {
          siteId: siteByKey[key],
          fullName: `Utilisateur Test E2E (costing ${key})`,
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

    async function seedSite(siteId: string, suffix: string) {
      const material = await prisma.article.create({
        data: {
          siteId,
          type: ArticleType.MATIERE_PREMIERE,
          openSiReference: `E2E-COSTING-${suffix}-MP`,
          name: `Matière test e2e costing ${suffix}`,
          unitOfMeasure: 'L',
          currentUnitCost: 2,
        },
      });
      const finished = await prisma.article.create({
        data: {
          siteId,
          type: ArticleType.PRODUIT_FINI,
          openSiReference: `E2E-COSTING-${suffix}-FP`,
          name: `Produit fini test e2e costing ${suffix}`,
          unitOfMeasure: 'unité',
          currentUnitCost: 1,
        },
      });
      const recipe = await prisma.recipe.create({
        data: {
          siteId,
          finishedProductId: finished.id,
          format: 100,
          version: 1,
          status: 'ACTIVE',
        },
      });
      const machine = await prisma.machine.create({
        data: {
          siteId,
          name: `Machine test e2e costing ${suffix}`,
          supportedFormats: [100],
          active: true,
        },
      });
      const user = await prisma.user.findFirstOrThrow({ where: { siteId } });
      const batch = await prisma.batch.create({
        data: {
          siteId,
          recipeId: recipe.id,
          machineId: machine.id,
          format: 100,
          plannedQuantity: 500,
          producedQuantity: 480,
          rejectedQuantity: 20,
          status: BatchStatus.TERMINE,
          currentStep: BatchStep.CONDITIONNEMENT,
          createdByUserId: user.id,
          startedAt: new Date('2026-08-01T08:00:00.000Z'),
          endedAt: new Date('2026-08-01T16:00:00.000Z'),
        },
      });
      const lot = await prisma.lot.create({
        data: {
          siteId,
          batchId: batch.id,
          lotNumber: `E2E-COSTING-${Date.now()}-${suffix}`,
          quantity: 500,
          manufacturedAt: new Date('2026-08-01T16:00:00.000Z'),
        },
      });
      await prisma.batchCost.create({
        data: {
          lotId: lot.id,
          batchId: batch.id,
          materialCostTotal: 100,
          packagingCostTotal: 50,
          unitCostPerFlacon: 0.3,
          producedQuantityTotal: 500,
        },
      });
      return { lotId: lot.id, batchId: batch.id };
    }

    const seededA = await seedSite(siteAId, 'A');
    lotAId = seededA.lotId;
    batchAId = seededA.batchId;
    const seededB = await seedSite(siteBId, 'B');
    lotBId = seededB.lotId;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.batchCost.deleteMany({
        where: { batch: { siteId: { in: [siteAId, siteBId] } } },
      });
      await prisma.lot.deleteMany({
        where: { siteId: { in: [siteAId, siteBId] } },
      });
      await prisma.batch.deleteMany({
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

  describe('GET /costing/lots/:lotId/cost', () => {
    it('retourne le coût figé du lot pour un utilisateur du site courant (200)', async () => {
      const response = await request(app.getHttpServer())
        .get(`/costing/lots/${lotAId}/cost`)
        .set('Authorization', `Bearer ${tokens.lab}`)
        .expect(200);

      const body = response.body as BatchCostResponseBody;
      expect(body.lotId).toBe(lotAId);
      expect(body.batchId).toBe(batchAId);
      expect(body.materialCostTotal).toBe('100');
      expect(body.packagingCostTotal).toBe('50');
      expect(body.unitCostPerFlacon).toBe('0.3');
      expect(body.producedQuantityTotal).toBe(500);
    });

    it('autorise DIRECTION en lecture (200)', () => {
      return request(app.getHttpServer())
        .get(`/costing/lots/${lotAId}/cost`)
        .set('Authorization', `Bearer ${tokens.direction}`)
        .expect(200);
    });

    it('autorise DAF en lecture (200)', () => {
      return request(app.getHttpServer())
        .get(`/costing/lots/${lotAId}/cost`)
        .set('Authorization', `Bearer ${tokens.daf}`)
        .expect(200);
    });

    it('retourne 404 pour un UUID inexistant', () => {
      return request(app.getHttpServer())
        .get('/costing/lots/00000000-0000-0000-0000-000000000000/cost')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .expect(404);
    });

    it('retourne 404 (pas 403) pour un lot appartenant à un autre site — ne révèle pas son existence', () => {
      return request(app.getHttpServer())
        .get(`/costing/lots/${lotBId}/cost`)
        .set('Authorization', `Bearer ${tokens.lab}`)
        .expect(404);
    });

    it('contrôle : ce même lot reste bien accessible à un utilisateur de son propre site (200)', async () => {
      const response = await request(app.getHttpServer())
        .get(`/costing/lots/${lotBId}/cost`)
        .set('Authorization', `Bearer ${tokens.siteB}`)
        .expect(200);

      expect((response.body as BatchCostResponseBody).lotId).toBe(lotBId);
    });

    it('refuse une requête non authentifiée (401)', () => {
      return request(app.getHttpServer())
        .get(`/costing/lots/${lotAId}/cost`)
        .expect(401);
    });

    it("n'expose aucune route de recalcul ou de correction (PATCH/PUT/DELETE introuvables)", async () => {
      await request(app.getHttpServer())
        .patch(`/costing/lots/${lotAId}/cost`)
        .set('Authorization', `Bearer ${tokens.lab}`)
        .expect(404);
      await request(app.getHttpServer())
        .put(`/costing/lots/${lotAId}/cost`)
        .set('Authorization', `Bearer ${tokens.lab}`)
        .expect(404);
      await request(app.getHttpServer())
        .delete(`/costing/lots/${lotAId}/cost`)
        .set('Authorization', `Bearer ${tokens.lab}`)
        .expect(404);
    });
  });
});
