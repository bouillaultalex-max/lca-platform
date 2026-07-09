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

interface FeedbackResponseBody {
  id: string;
  status: string;
  appVersion: string;
}

/**
 * Vérifie que le système de retours (V0.3) est bien ouvert à tout utilisateur
 * authentifié en écriture (même les rôles lecture seule, ex: DIRECTION), mais
 * réservé aux administrateurs système en lecture/traitement.
 */
describe('Feedback (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const password = 'MotDePasseTest123!';
  const emails = {
    admin: 'e2e-feedback-admin@lca-mes.local',
    direction: 'e2e-feedback-direction@lca-mes.local',
  };
  const tokens: Record<'admin' | 'direction', string> = {
    admin: '',
    direction: '',
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

    const site =
      (await prisma.site.findFirst()) ??
      (await prisma.site.create({ data: { name: 'Site de test e2e' } }));
    const passwordHash = await bcrypt.hash(password, 4);

    await prisma.user.upsert({
      where: { email: emails.admin },
      update: { passwordHash, active: true, isSystemAdmin: true },
      create: {
        siteId: site.id,
        fullName: 'Administrateur Test E2E Feedback',
        email: emails.admin,
        passwordHash,
        role: UserRole.RESPONSABLE_ADJOINT,
        isSystemAdmin: true,
      },
    });

    await prisma.user.upsert({
      where: { email: emails.direction },
      update: { passwordHash, active: true },
      create: {
        siteId: site.id,
        fullName: 'Direction Test E2E Feedback',
        email: emails.direction,
        passwordHash,
        role: UserRole.DIRECTION,
        isSystemAdmin: false,
      },
    });

    for (const key of Object.keys(emails) as Array<keyof typeof emails>) {
      const loginResponse = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: emails[key], password });
      tokens[key] = (loginResponse.body as LoginResponseBody).accessToken;
    }
  });

  afterAll(async () => {
    if (prisma) {
      const users = await prisma.user.findMany({
        where: { email: { in: Object.values(emails) } },
      });
      await prisma.feedback.deleteMany({
        where: { userId: { in: users.map((u) => u.id) } },
      });
      await prisma.user.deleteMany({
        where: { email: { in: Object.values(emails) } },
      });
    }
    if (app) {
      await app.close();
    }
  });

  describe('POST /feedback', () => {
    it('refuse une requête sans token (401)', () => {
      return request(app.getHttpServer())
        .post('/feedback')
        .send({ type: 'BUG', message: 'x', pageUrl: '/stock' })
        .expect(401);
    });

    it('autorise un rôle lecture seule (DIRECTION) à envoyer un retour (201), avec la version applicative figée', async () => {
      const response = await request(app.getHttpServer())
        .post('/feedback')
        .set('Authorization', `Bearer ${tokens.direction}`)
        .send({
          type: 'IDEE',
          priority: 'IMPORTANTE',
          message: 'Ce serait bien de pouvoir exporter le stock en PDF.',
          pageUrl: '/stock',
        })
        .expect(201);

      const body = response.body as FeedbackResponseBody;
      expect(body.status).toBe('NOUVEAU');
      expect(body.appVersion).toEqual(expect.any(String));
      expect(body.appVersion.length).toBeGreaterThan(0);
    });

    it('rejette un message vide (400)', () => {
      return request(app.getHttpServer())
        .post('/feedback')
        .set('Authorization', `Bearer ${tokens.direction}`)
        .send({ type: 'BUG', message: '', pageUrl: '/stock' })
        .expect(400);
    });

    it('rejette un type invalide (400)', () => {
      return request(app.getHttpServer())
        .post('/feedback')
        .set('Authorization', `Bearer ${tokens.direction}`)
        .send({ type: 'PAS_UN_TYPE', message: 'x', pageUrl: '/stock' })
        .expect(400);
    });
  });

  describe('GET /feedback', () => {
    it('refuse un utilisateur non-administrateur système (403)', () => {
      return request(app.getHttpServer())
        .get('/feedback')
        .set('Authorization', `Bearer ${tokens.direction}`)
        .expect(403);
    });

    it('autorise un administrateur système (200) et retourne les retours créés', async () => {
      const response = await request(app.getHttpServer())
        .get('/feedback')
        .set('Authorization', `Bearer ${tokens.admin}`)
        .expect(200);

      const body = response.body as FeedbackResponseBody[];
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThan(0);
    });
  });

  describe('PATCH /feedback/:id/treated', () => {
    it('refuse un utilisateur non-administrateur système (403)', async () => {
      const created = await request(app.getHttpServer())
        .post('/feedback')
        .set('Authorization', `Bearer ${tokens.direction}`)
        .send({
          type: 'QUESTION',
          message: 'Question test.',
          pageUrl: '/production',
        })
        .expect(201);
      const id = (created.body as FeedbackResponseBody).id;

      return request(app.getHttpServer())
        .patch(`/feedback/${id}/treated`)
        .set('Authorization', `Bearer ${tokens.direction}`)
        .expect(403);
    });

    it('bascule le statut vers TRAITE pour un administrateur système (200)', async () => {
      const created = await request(app.getHttpServer())
        .post('/feedback')
        .set('Authorization', `Bearer ${tokens.direction}`)
        .send({
          type: 'AMELIORATION',
          message: 'Amélioration test.',
          pageUrl: '/production',
        })
        .expect(201);
      const id = (created.body as FeedbackResponseBody).id;

      const response = await request(app.getHttpServer())
        .patch(`/feedback/${id}/treated`)
        .set('Authorization', `Bearer ${tokens.admin}`)
        .expect(200);

      expect((response.body as FeedbackResponseBody).status).toBe('TRAITE');
    });

    it('renvoie 404 pour un retour inexistant', () => {
      return request(app.getHttpServer())
        .patch('/feedback/00000000-0000-0000-0000-000000000000/treated')
        .set('Authorization', `Bearer ${tokens.admin}`)
        .expect(404);
    });
  });
});
