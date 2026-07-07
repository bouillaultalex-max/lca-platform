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
  user: { id: string; email: string; mustChangePassword: boolean };
}

interface CreatedUserResponseBody {
  user: { id: string; email: string };
  temporaryPassword: string;
}

describe('Gestion des utilisateurs (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const adminEmail = 'e2e-admin@lca-mes.local';
  const adminPassword = 'MotDePasseAdmin123!';
  const nonAdminEmail = 'e2e-non-admin@lca-mes.local';
  const nonAdminPassword = 'MotDePasseLabo123!';
  const newUserEmail = 'e2e-kevin@lca-mes.local';

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

    const adminPasswordHash = await bcrypt.hash(adminPassword, 4);
    await prisma.user.upsert({
      where: { email: adminEmail },
      update: {
        passwordHash: adminPasswordHash,
        active: true,
        isSystemAdmin: true,
      },
      create: {
        siteId: site.id,
        fullName: 'Administrateur Test E2E',
        email: adminEmail,
        passwordHash: adminPasswordHash,
        role: UserRole.RESPONSABLE_ADJOINT,
        isSystemAdmin: true,
      },
    });

    const nonAdminPasswordHash = await bcrypt.hash(nonAdminPassword, 4);
    await prisma.user.upsert({
      where: { email: nonAdminEmail },
      update: { passwordHash: nonAdminPasswordHash, active: true },
      create: {
        siteId: site.id,
        fullName: 'Non Admin Test E2E',
        email: nonAdminEmail,
        passwordHash: nonAdminPasswordHash,
        role: UserRole.RESPONSABLE_LABORATOIRE,
        isSystemAdmin: false,
      },
    });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.user.deleteMany({
        where: { email: { in: [adminEmail, nonAdminEmail, newUserEmail] } },
      });
      await prisma.jobTitle.deleteMany({ where: { name: 'Poste Test E2E' } });
    }
    if (app) {
      await app.close();
    }
  });

  async function loginAs(email: string, password: string) {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    return response.body as LoginResponseBody;
  }

  it("refuse à un utilisateur non-administrateur système l'accès à /auth/users", async () => {
    const { accessToken } = await loginAs(nonAdminEmail, nonAdminPassword);

    await request(app.getHttpServer())
      .get('/auth/users')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);
  });

  it('parcours complet : création, première connexion forcée, changement de mot de passe, désactivation', async () => {
    const { accessToken: adminToken } = await loginAs(
      adminEmail,
      adminPassword,
    );

    // 1. L'administrateur crée une fonction métier.
    const jobTitleResponse = await request(app.getHttpServer())
      .post('/auth/job-titles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Poste Test E2E' })
      .expect(201);
    const jobTitleId = (jobTitleResponse.body as { id: string }).id;

    // 2. L'administrateur crée un nouvel utilisateur.
    const createResponse = await request(app.getHttpServer())
      .post('/auth/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'Kevin Test E2E',
        email: newUserEmail,
        jobTitleId,
        role: UserRole.RESPONSABLE_LABORATOIRE,
      })
      .expect(201);
    const created = createResponse.body as CreatedUserResponseBody;
    expect(created.temporaryPassword).toEqual(expect.any(String));

    // 3. Le nouvel utilisateur se connecte avec le mot de passe temporaire.
    const firstLogin = await loginAs(newUserEmail, created.temporaryPassword);
    expect(firstLogin.user.mustChangePassword).toBe(true);

    // 4. Bloqué sur toute route hors /auth/me et /auth/change-password.
    await request(app.getHttpServer())
      .get('/auth/users')
      .set('Authorization', `Bearer ${firstLogin.accessToken}`)
      .expect(403)
      .expect((res) => {
        expect((res.body as { error?: string }).error).toBe(
          'PASSWORD_CHANGE_REQUIRED',
        );
      });

    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${firstLogin.accessToken}`)
      .expect(200);

    // 5. Change son mot de passe.
    await request(app.getHttpServer())
      .post('/auth/change-password')
      .set('Authorization', `Bearer ${firstLogin.accessToken}`)
      .send({
        currentPassword: created.temporaryPassword,
        newPassword: 'NouveauMotDePasse456!',
      })
      .expect(200);

    // 6. Accès normal restauré après changement de mot de passe.
    const secondLogin = await loginAs(newUserEmail, 'NouveauMotDePasse456!');
    expect(secondLogin.user.mustChangePassword).toBe(false);

    // 7. L'administrateur désactive le compte.
    await request(app.getHttpServer())
      .delete(`/auth/users/${created.user.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    // 8. Le compte désactivé ne peut plus se connecter.
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: newUserEmail, password: 'NouveauMotDePasse456!' })
      .expect(401);
  });

  it('empêche un administrateur de désactiver son propre compte', async () => {
    const { accessToken: adminToken, user } = await loginAs(
      adminEmail,
      adminPassword,
    );

    await request(app.getHttpServer())
      .delete(`/auth/users/${user.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(403);
  });
});
