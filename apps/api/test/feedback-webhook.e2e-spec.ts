import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../src/prisma/prisma.service';
import { UserRole } from '../generated/prisma/client';

interface LoginResponseBody {
  accessToken: string;
}

interface FeedbackResponseBody {
  id: string;
}

interface ReceivedWebhookRequest {
  contentType: string | undefined;
  body: Record<string, unknown>;
}

/**
 * Vérifie l'intégration bout en bout POST /feedback -> webhook Make, entièrement
 * contre un serveur HTTP local (127.0.0.1, port éphémère) qui tient lieu de Make —
 * jamais contre une vraie URL Make. `MAKE_FEEDBACK_WEBHOOK_URL` est positionnée sur
 * ce serveur local AVANT de charger `AppModule` (import dynamique, après le
 * `process.env.MAKE_FEEDBACK_WEBHOOK_URL = ...` ci-dessous), pour que
 * `ConfigService` la capture dès la construction du module.
 */
describe('Feedback -> webhook Make (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mockMakeServer: http.Server;
  let receivedRequests: ReceivedWebhookRequest[];
  let mockMakeResponseStatus = 200;
  let mockMakeDelayMs = 0;

  const password = 'MotDePasseTest123!';
  const email = 'e2e-feedback-webhook@lca-mes.local';
  let token = '';

  beforeAll(async () => {
    receivedRequests = [];
    mockMakeServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString()));
      req.on('end', () => {
        setTimeout(() => {
          receivedRequests.push({
            contentType: req.headers['content-type'],
            body: JSON.parse(body || '{}') as Record<string, unknown>,
          });
          res.writeHead(mockMakeResponseStatus, {
            'Content-Type': 'application/json',
          });
          res.end('{}');
        }, mockMakeDelayMs);
      });
    });
    await new Promise<void>((resolve) =>
      mockMakeServer.listen(0, '127.0.0.1', resolve),
    );
    const { port } = mockMakeServer.address() as AddressInfo;
    process.env.MAKE_FEEDBACK_WEBHOOK_URL = `http://127.0.0.1:${port}`;

    // Import dynamique délibéré : garantit que MAKE_FEEDBACK_WEBHOOK_URL est déjà
    // positionnée au moment où AppModule (et son ConfigModule.forRoot) s'évalue.
    const { AppModule } =
      (await import('./../src/app.module')) as typeof import('./../src/app.module');
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
      where: { email },
      update: { passwordHash, active: true },
      create: {
        siteId: site.id,
        fullName: 'Utilisateur Test E2E (webhook Make)',
        email,
        passwordHash,
        role: UserRole.RESPONSABLE_LABORATOIRE,
      },
    });

    const loginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password });
    token = (loginResponse.body as LoginResponseBody).accessToken;
  });

  afterAll(async () => {
    delete process.env.MAKE_FEEDBACK_WEBHOOK_URL;
    if (prisma) {
      const user = await prisma.user.findUnique({ where: { email } });
      if (user) {
        await prisma.feedback.deleteMany({ where: { userId: user.id } });
      }
      await prisma.user.deleteMany({ where: { email } });
    }
    if (app) {
      await app.close();
    }
    await new Promise<void>((resolve) => mockMakeServer.close(() => resolve()));
  });

  beforeEach(() => {
    receivedRequests = [];
    mockMakeResponseStatus = 200;
    mockMakeDelayMs = 0;
  });

  it('crée le retour (201) et transmet le payload attendu au webhook Make', async () => {
    const response = await request(app.getHttpServer())
      .post('/feedback')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'BUG',
        priority: 'IMPORTANTE',
        message: 'Le bouton Enregistrer ne répond pas.',
        pageUrl: '/catalog',
      })
      .expect(201);

    const feedbackId = (response.body as FeedbackResponseBody).id;

    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(receivedRequests).toHaveLength(1);
    expect(receivedRequests[0].contentType).toBe('application/json');
    expect(receivedRequests[0].body).toMatchObject({
      feedbackId,
      email,
      type: 'BUG',
      priority: 'IMPORTANTE',
      page: '/catalog',
      message: 'Le bouton Enregistrer ne répond pas.',
      status: 'NOUVEAU',
    });
    expect(Object.keys(receivedRequests[0].body).sort()).toEqual(
      [
        'createdAt',
        'email',
        'feedbackId',
        'message',
        'page',
        'priority',
        'siteId',
        'status',
        'type',
        'user',
        'version',
      ].sort(),
    );
  });

  it('crée quand même le retour (201) si le webhook Make répond une erreur serveur (500)', async () => {
    mockMakeResponseStatus = 500;

    const response = await request(app.getHttpServer())
      .post('/feedback')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'IDEE', message: 'Une idée.', pageUrl: '/stock' })
      .expect(201);

    const feedbackId = (response.body as FeedbackResponseBody).id;
    const stored = await prisma.feedback.findUnique({
      where: { id: feedbackId },
    });
    expect(stored).not.toBeNull();
  });

  it('répond rapidement même si le webhook Make est très lent (non bloquant)', async () => {
    mockMakeDelayMs = 3000;

    const startedAt = Date.now();
    const response = await request(app.getHttpServer())
      .post('/feedback')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'QUESTION',
        message: 'Une question.',
        pageUrl: '/production',
      })
      .expect(201);
    const elapsedMs = Date.now() - startedAt;

    expect(elapsedMs).toBeLessThan(1000);
    const stored = await prisma.feedback.findUnique({
      where: { id: (response.body as FeedbackResponseBody).id },
    });
    expect(stored).not.toBeNull();
  });
});
