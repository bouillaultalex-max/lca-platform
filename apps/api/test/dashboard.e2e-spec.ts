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

interface DashboardSummaryBody {
  articlesCount: number;
  activeRecipesCount: number;
  activeMachinesCount: number;
  stockLotsCount: number;
  openBatchesCount: number;
  unresolvedFeedbackCount: number;
  pendingExpectedRequirementsCount: number;
}

/**
 * Vérifie que la synthèse du tableau de bord est accessible à tout utilisateur
 * authentifié (y compris les rôles en lecture seule, ex: DIRECTION), puisqu'elle
 * n'expose que des compteurs déjà visibles ailleurs dans l'application.
 */
describe('Dashboard (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const password = 'MotDePasseTest123!';
  const email = 'e2e-dashboard-direction@lca-mes.local';
  let token = '';

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
      where: { email },
      update: { passwordHash, active: true },
      create: {
        siteId: site.id,
        fullName: 'Direction Test E2E Dashboard',
        email,
        passwordHash,
        role: UserRole.DIRECTION,
        isSystemAdmin: false,
      },
    });

    const loginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password });
    token = (loginResponse.body as LoginResponseBody).accessToken;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.user.deleteMany({ where: { email } });
    }
    if (app) {
      await app.close();
    }
  });

  it('refuse une requête sans token (401)', () => {
    return request(app.getHttpServer()).get('/dashboard/summary').expect(401);
  });

  it('autorise un rôle lecture seule (DIRECTION) et retourne les 7 compteurs attendus', async () => {
    const response = await request(app.getHttpServer())
      .get('/dashboard/summary')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = response.body as DashboardSummaryBody;
    for (const key of [
      'articlesCount',
      'activeRecipesCount',
      'activeMachinesCount',
      'stockLotsCount',
      'openBatchesCount',
      'unresolvedFeedbackCount',
      'pendingExpectedRequirementsCount',
    ] as const) {
      expect(typeof body[key]).toBe('number');
      expect(body[key]).toBeGreaterThanOrEqual(0);
    }
  });
});
