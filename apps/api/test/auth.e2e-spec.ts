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
  user: { email: string; role: UserRole; passwordHash?: string };
}

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const testEmail = 'e2e-auth-test@lca-mes.local';
  const testPassword = 'MotDePasseTest123!';

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
    const passwordHash = await bcrypt.hash(testPassword, 4); // coût réduit : uniquement pour accélérer les tests

    await prisma.user.upsert({
      where: { email: testEmail },
      update: { passwordHash, active: true },
      create: {
        siteId: site.id,
        fullName: 'Utilisateur Test E2E',
        email: testEmail,
        passwordHash,
        role: UserRole.RESPONSABLE_LABORATOIRE,
      },
    });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.user.deleteMany({ where: { email: testEmail } });
    }
    if (app) {
      await app.close();
    }
  });

  describe('POST /auth/login', () => {
    it('refuse un email inconnu', () => {
      return request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'inconnu@lca-mes.local', password: 'peu-importe123' })
        .expect(401);
    });

    it('refuse un mot de passe incorrect', () => {
      return request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: testEmail, password: 'mauvais-mot-de-passe' })
        .expect(401);
    });

    it('rejette une requête mal formée (validation DTO)', () => {
      return request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'pas-un-email', password: 'x' })
        .expect(400);
    });

    it('retourne un accessToken et le profil utilisateur pour des identifiants valides', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: testEmail, password: testPassword })
        .expect(200);

      const body = response.body as LoginResponseBody;
      expect(body.accessToken).toEqual(expect.any(String));
      expect(body.user).toMatchObject({
        email: testEmail,
        role: UserRole.RESPONSABLE_LABORATOIRE,
      });
      expect(body.user.passwordHash).toBeUndefined();
    });
  });

  describe('GET /auth/me', () => {
    it('refuse une requête sans token (401)', () => {
      return request(app.getHttpServer()).get('/auth/me').expect(401);
    });

    it('refuse un token invalide (401)', () => {
      return request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', 'Bearer un-token-invalide')
        .expect(401);
    });

    it('retourne le profil pour un token valide', async () => {
      const loginResponse = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: testEmail, password: testPassword })
        .expect(200);

      const { accessToken } = loginResponse.body as LoginResponseBody;

      const meResponse = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect((meResponse.body as { email: string }).email).toBe(testEmail);
    });
  });
});
