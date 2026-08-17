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
  QualityCheckResult,
  QualityCheckType,
  UserRole,
} from '../generated/prisma/client';

interface LoginResponseBody {
  accessToken: string;
}

interface QualityCheckResponseBody {
  id: string;
  lotId: string;
  type: string;
  result: string;
  controllerId: string;
  checkedAt: string;
  comment: string | null;
}

interface LotQualityResponseBody {
  id: string;
  qualityStatus: string;
  qualityChecks: QualityCheckResponseBody[];
}

/**
 * Couverture e2e du module `quality` (QUA-01/QUA-03, voir ADR 0008) :
 * consultation ouverte à tout utilisateur authentifié y compris DIRECTION/DAF,
 * écriture réservée à FULL_ACCESS_ROLES, cloisonnement par site via
 * `Lot.siteId` (`QualityCheck` n'a pas de `siteId` propre), recalcul atomique
 * de `Lot.qualityStatus` (voir `QualityChecksService`), journalisation
 * `AuditLog`, aucune route de modification ou de suppression (immutabilité V1).
 */
describe('Quality (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  let siteAId: string;
  let siteBId: string;

  // lotA1 : scénario d'écriture (cycle de vie complet du statut).
  let lotA1Id: string;
  // lotA2 : scénario de lecture pure (jamais écrit), pour les tests de permissions GET.
  let lotA2Id: string;
  // lotB : site B — audit, isolation de site, contrôle d'accès pour son propre site.
  let lotBId: string;

  const password = 'MotDePasseTest123!';
  const emails = {
    lab: 'e2e-quality-lab@lca-mes.local',
    direction: 'e2e-quality-direction@lca-mes.local',
    daf: 'e2e-quality-daf@lca-mes.local',
    siteB: 'e2e-quality-siteb@lca-mes.local',
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
      data: { name: 'Site e2e quality A' },
    });
    const siteB = await prisma.site.create({
      data: { name: 'Site e2e quality B' },
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
          fullName: `Utilisateur Test E2E (quality ${key})`,
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

    async function seedLot(siteId: string, suffix: string): Promise<string> {
      const finished = await prisma.article.create({
        data: {
          siteId,
          type: ArticleType.PRODUIT_FINI,
          openSiReference: `E2E-QUALITY-${suffix}-FP`,
          name: `Produit fini test e2e quality ${suffix}`,
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
          name: `Machine test e2e quality ${suffix}`,
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
          lotNumber: `E2E-QUALITY-${Date.now()}-${suffix}`,
          quantity: 500,
          manufacturedAt: new Date('2026-08-01T16:00:00.000Z'),
        },
      });
      return lot.id;
    }

    lotA1Id = await seedLot(siteAId, 'A1');
    lotA2Id = await seedLot(siteAId, 'A2');
    lotBId = await seedLot(siteBId, 'B');
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.qualityCheck.deleteMany({
        where: { lot: { siteId: { in: [siteAId, siteBId] } } },
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

  describe('POST /quality/lots/:lotId/checks', () => {
    it(
      'cycle de vie complet du statut (201) : EN_ATTENTE → CONFORME après un contrôle conforme → ' +
        'NON_CONFORME dès un contrôle non conforme → reste NON_CONFORME après un contrôle conforme ultérieur (immutabilité V1, ADR 0008 décision 3)',
      async () => {
        const initial = await request(app.getHttpServer())
          .get(`/quality/lots/${lotA1Id}`)
          .set('Authorization', `Bearer ${tokens.lab}`)
          .expect(200);
        expect((initial.body as LotQualityResponseBody).qualityStatus).toBe(
          'EN_ATTENTE',
        );
        expect((initial.body as LotQualityResponseBody).qualityChecks).toHaveLength(
          0,
        );

        const firstCheck = await request(app.getHttpServer())
          .post(`/quality/lots/${lotA1Id}/checks`)
          .set('Authorization', `Bearer ${tokens.lab}`)
          .send({
            type: QualityCheckType.VISUEL,
            result: QualityCheckResult.CONFORME,
            checkedAt: '2026-08-17T10:00:00.000Z',
            comment: 'Contrôle visuel initial',
          })
          .expect(201);
        const firstBody = firstCheck.body as QualityCheckResponseBody;
        expect(firstBody.lotId).toBe(lotA1Id);
        expect(firstBody.type).toBe(QualityCheckType.VISUEL);
        expect(firstBody.result).toBe(QualityCheckResult.CONFORME);

        const afterFirst = await request(app.getHttpServer())
          .get(`/quality/lots/${lotA1Id}`)
          .set('Authorization', `Bearer ${tokens.lab}`)
          .expect(200);
        expect((afterFirst.body as LotQualityResponseBody).qualityStatus).toBe(
          'CONFORME',
        );
        expect(
          (afterFirst.body as LotQualityResponseBody).qualityChecks,
        ).toHaveLength(1);

        await request(app.getHttpServer())
          .post(`/quality/lots/${lotA1Id}/checks`)
          .set('Authorization', `Bearer ${tokens.lab}`)
          .send({
            type: QualityCheckType.PHYSICO_CHIMIQUE,
            result: QualityCheckResult.NON_CONFORME,
          })
          .expect(201);

        const afterNonConforme = await request(app.getHttpServer())
          .get(`/quality/lots/${lotA1Id}`)
          .set('Authorization', `Bearer ${tokens.lab}`)
          .expect(200);
        expect(
          (afterNonConforme.body as LotQualityResponseBody).qualityStatus,
        ).toBe('NON_CONFORME');

        // Un contrôle conforme ultérieur ne fait pas revenir le lot à CONFORME :
        // un NON_CONFORME déjà enregistré reste dans l'ensemble évalué pour toujours
        // (aucune correction/suppression possible en V1, voir ADR 0008 décision 3).
        await request(app.getHttpServer())
          .post(`/quality/lots/${lotA1Id}/checks`)
          .set('Authorization', `Bearer ${tokens.lab}`)
          .send({
            type: QualityCheckType.DOCUMENTAIRE,
            result: QualityCheckResult.CONFORME_AVEC_RESERVE,
          })
          .expect(201);

        const final = await request(app.getHttpServer())
          .get(`/quality/lots/${lotA1Id}`)
          .set('Authorization', `Bearer ${tokens.lab}`)
          .expect(200);
        expect((final.body as LotQualityResponseBody).qualityStatus).toBe(
          'NON_CONFORME',
        );
        expect((final.body as LotQualityResponseBody).qualityChecks).toHaveLength(
          3,
        );
      },
    );

    it('journalise la création dans AuditLog (action CREATE, entity QualityCheck)', async () => {
      const response = await request(app.getHttpServer())
        .post(`/quality/lots/${lotBId}/checks`)
        .set('Authorization', `Bearer ${tokens.siteB}`)
        .send({
          type: QualityCheckType.VISUEL,
          result: QualityCheckResult.CONFORME,
        })
        .expect(201);
      const body = response.body as QualityCheckResponseBody;

      const auditEntry = await prisma.auditLog.findFirst({
        where: { entity: 'QualityCheck', entityId: body.id },
      });
      expect(auditEntry).not.toBeNull();
      expect(auditEntry?.action).toBe('CREATE');
      expect(auditEntry?.entityId).toBe(body.id);
    });

    it('refuse un utilisateur DIRECTION (403)', () => {
      return request(app.getHttpServer())
        .post(`/quality/lots/${lotA1Id}/checks`)
        .set('Authorization', `Bearer ${tokens.direction}`)
        .send({
          type: QualityCheckType.VISUEL,
          result: QualityCheckResult.CONFORME,
        })
        .expect(403);
    });

    it('refuse un utilisateur DAF (403)', () => {
      return request(app.getHttpServer())
        .post(`/quality/lots/${lotA1Id}/checks`)
        .set('Authorization', `Bearer ${tokens.daf}`)
        .send({
          type: QualityCheckType.VISUEL,
          result: QualityCheckResult.CONFORME,
        })
        .expect(403);
    });

    it('refuse une requête non authentifiée (401)', () => {
      return request(app.getHttpServer())
        .post(`/quality/lots/${lotA1Id}/checks`)
        .send({
          type: QualityCheckType.VISUEL,
          result: QualityCheckResult.CONFORME,
        })
        .expect(401);
    });

    it('retourne 404 pour un lot inexistant', () => {
      return request(app.getHttpServer())
        .post('/quality/lots/00000000-0000-0000-0000-000000000000/checks')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({
          type: QualityCheckType.VISUEL,
          result: QualityCheckResult.CONFORME,
        })
        .expect(404);
    });

    it('retourne 404 (pas 403) pour un lot appartenant à un autre site — ne révèle pas son existence', () => {
      return request(app.getHttpServer())
        .post(`/quality/lots/${lotBId}/checks`)
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({
          type: QualityCheckType.VISUEL,
          result: QualityCheckResult.CONFORME,
        })
        .expect(404);
    });
  });

  describe('GET /quality/lots/:lotId', () => {
    it('retourne le statut et les contrôles pour un utilisateur du site courant (200)', async () => {
      const response = await request(app.getHttpServer())
        .get(`/quality/lots/${lotA2Id}`)
        .set('Authorization', `Bearer ${tokens.lab}`)
        .expect(200);

      const body = response.body as LotQualityResponseBody;
      expect(body.id).toBe(lotA2Id);
      expect(body.qualityStatus).toBe('EN_ATTENTE');
      expect(body.qualityChecks).toEqual([]);
    });

    it('autorise DIRECTION en lecture (200)', () => {
      return request(app.getHttpServer())
        .get(`/quality/lots/${lotA2Id}`)
        .set('Authorization', `Bearer ${tokens.direction}`)
        .expect(200);
    });

    it('autorise DAF en lecture (200)', () => {
      return request(app.getHttpServer())
        .get(`/quality/lots/${lotA2Id}`)
        .set('Authorization', `Bearer ${tokens.daf}`)
        .expect(200);
    });

    it('retourne 404 pour un UUID inexistant', () => {
      return request(app.getHttpServer())
        .get('/quality/lots/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .expect(404);
    });

    it('retourne 404 (pas 403) pour un lot appartenant à un autre site — ne révèle pas son existence', () => {
      return request(app.getHttpServer())
        .get(`/quality/lots/${lotBId}`)
        .set('Authorization', `Bearer ${tokens.lab}`)
        .expect(404);
    });

    it('reste accessible à un utilisateur de son propre site (200)', async () => {
      const response = await request(app.getHttpServer())
        .get(`/quality/lots/${lotBId}`)
        .set('Authorization', `Bearer ${tokens.siteB}`)
        .expect(200);

      expect((response.body as LotQualityResponseBody).id).toBe(lotBId);
    });

    it('refuse une requête non authentifiée (401)', () => {
      return request(app.getHttpServer())
        .get(`/quality/lots/${lotA2Id}`)
        .expect(401);
    });

    it("n'expose aucune route de modification ou de suppression (PATCH/PUT/DELETE introuvables)", async () => {
      await request(app.getHttpServer())
        .patch(`/quality/lots/${lotA2Id}/checks`)
        .set('Authorization', `Bearer ${tokens.lab}`)
        .expect(404);
      await request(app.getHttpServer())
        .put(`/quality/lots/${lotA2Id}/checks`)
        .set('Authorization', `Bearer ${tokens.lab}`)
        .expect(404);
      await request(app.getHttpServer())
        .delete(`/quality/lots/${lotA2Id}/checks`)
        .set('Authorization', `Bearer ${tokens.lab}`)
        .expect(404);
      await request(app.getHttpServer())
        .patch(`/quality/lots/${lotA2Id}`)
        .set('Authorization', `Bearer ${tokens.lab}`)
        .expect(404);
      await request(app.getHttpServer())
        .delete(`/quality/lots/${lotA2Id}`)
        .set('Authorization', `Bearer ${tokens.lab}`)
        .expect(404);
    });
  });
});
