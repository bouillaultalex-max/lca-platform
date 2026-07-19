import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getOptionsToken } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import * as bcrypt from 'bcryptjs';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { UserRole } from '../generated/prisma/client';

interface ThrottlerErrorBody {
  statusCode: number;
  message: string;
}

/**
 * Tests dédiés à la limitation de débit sur POST /auth/login (voir SEC-02).
 * Utilise une fenêtre volontairement courte (300 ms) via `overrideProvider`, pour
 * un test rapide et déterministe — la valeur réelle en production (voir
 * `login-throttle.constants.ts`) est plus large (10 tentatives / 60 s), inutilisable
 * telle quelle dans un test automatisé sans le ralentir considérablement.
 *
 * Une seule application Nest est partagée par tous les tests de ce fichier (le
 * compteur en mémoire de ThrottlerGuard est donc partagé aussi) : `afterEach`
 * attend systématiquement l'expiration complète de la fenêtre + du blocage avant le
 * test suivant, pour que chaque test reparte d'un compteur remis à zéro.
 */
describe('Auth — limitation de débit (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const testEmail = 'e2e-throttle-test@lca-mes.local';
  const testPassword = 'MotDePasseTest123!';
  const wrongPassword = 'mauvais-mot-de-passe';

  const TEST_TTL_MS = 300;
  const TEST_LIMIT = 3;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(getOptionsToken())
      .useValue([{ ttl: TEST_TTL_MS, limit: TEST_LIMIT }])
      .compile();

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
    const passwordHash = await bcrypt.hash(testPassword, 4); // coût réduit : uniquement pour accélérer les tests

    await prisma.user.upsert({
      where: { email: testEmail },
      update: { passwordHash, active: true },
      create: {
        siteId: site.id,
        fullName: 'Utilisateur Test E2E Throttle',
        email: testEmail,
        passwordHash,
        role: UserRole.RESPONSABLE_LABORATOIRE,
      },
    });
  });

  afterEach(async () => {
    // Laisse le compteur en mémoire de ThrottlerGuard revenir à zéro (fenêtre +
    // éventuel blocage) avant le test suivant, pour une isolation complète entre tests.
    await new Promise((resolve) => setTimeout(resolve, TEST_TTL_MS + 250));
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.user.deleteMany({ where: { email: testEmail } });
    }
    if (app) {
      await app.close();
    }
  });

  it('autorise plusieurs tentatives successives tant que la limite n’est pas atteinte', async () => {
    for (let attempt = 1; attempt <= TEST_LIMIT; attempt += 1) {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: testEmail, password: wrongPassword })
        .expect(401);
    }
  });

  it('bloque avec un 429 au-delà de la limite, dans un format d’erreur NestJS standard', async () => {
    for (let attempt = 1; attempt <= TEST_LIMIT; attempt += 1) {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: testEmail, password: wrongPassword })
        .expect(401);
    }

    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: testEmail, password: wrongPassword })
      .expect(429);

    const body = response.body as ThrottlerErrorBody;
    expect(body.statusCode).toBe(429);
    expect(body.message).toContain('Too Many Requests');
  });

  it('n’affecte aucune autre route (ex : GET /auth/me reste accessible)', async () => {
    // Épuise la limite sur /auth/login...
    for (let attempt = 1; attempt <= TEST_LIMIT + 1; attempt += 1) {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: testEmail, password: wrongPassword });
    }

    // ...mais une autre route (même non authentifiée ici) n'est jamais limitée.
    await request(app.getHttpServer()).get('/auth/me').expect(401); // 401 (pas de token), jamais 429
  });

  it('revient à un fonctionnement normal une fois la fenêtre expirée', async () => {
    for (let attempt = 1; attempt <= TEST_LIMIT; attempt += 1) {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: testEmail, password: wrongPassword })
        .expect(401);
    }
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: testEmail, password: wrongPassword })
      .expect(429);

    // Laisse expirer la fenêtre + le blocage (+ marge) avant de revérifier.
    await new Promise((resolve) => setTimeout(resolve, TEST_TTL_MS + 250));

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: testEmail, password: testPassword })
      .expect(200);
  });
});
