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

  // Identités partagées, connectées une seule fois dans le `beforeAll` ci-dessous et
  // réutilisées par la plupart des tests (voir `loginAs`) : POST /auth/login est limité
  // en débit (10 tentatives / 60 s / IP, SEC-02, voir `login-throttle.constants.ts`), et
  // ce fichier additionne autrement trop de connexions pour rester sous cette limite.
  // Seuls les tests qui exercent réellement un flux de connexion (mot de passe temporaire,
  // changement de mot de passe, compte désactivé...) effectuent leur propre `loginAs`.
  let sharedAdminToken: string;
  let sharedAdminUserId: string;
  let sharedNonAdminToken: string;
  let sharedNonAdminUserId: string;

  const adminEmail = 'e2e-admin@lca-mes.local';
  const adminPassword = 'MotDePasseAdmin123!';
  const nonAdminEmail = 'e2e-non-admin@lca-mes.local';
  const nonAdminPassword = 'MotDePasseLabo123!';
  const newUserEmail = 'e2e-kevin@lca-mes.local';
  const auditLogUserEmail = 'e2e-audit-log@lca-mes.local';
  const otherSiteUserEmail = 'e2e-other-site@lca-mes.local';

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

    // Compte rattaché à un site différent — sert uniquement à vérifier qu'un
    // administrateur système ne peut pas agir en dehors de son propre site
    // (voir `UserAdminService.findOne`, borné par siteId).
    const otherSite =
      (await prisma.site.findFirst({ where: { id: { not: site.id } } })) ??
      (await prisma.site.create({
        data: { name: 'Site de test e2e (autre site)' },
      }));
    const otherSitePasswordHash = await bcrypt.hash(
      'MotDePasseAutreSite123!',
      4,
    );
    await prisma.user.upsert({
      where: { email: otherSiteUserEmail },
      update: {
        passwordHash: otherSitePasswordHash,
        active: true,
        siteId: otherSite.id,
      },
      create: {
        siteId: otherSite.id,
        fullName: 'Utilisateur Autre Site E2E',
        email: otherSiteUserEmail,
        passwordHash: otherSitePasswordHash,
        role: UserRole.DAF,
        isSystemAdmin: false,
      },
    });

    const adminLogin = await loginAs(adminEmail, adminPassword);
    sharedAdminToken = adminLogin.accessToken;
    sharedAdminUserId = adminLogin.user.id;

    const nonAdminLogin = await loginAs(nonAdminEmail, nonAdminPassword);
    sharedNonAdminToken = nonAdminLogin.accessToken;
    sharedNonAdminUserId = nonAdminLogin.user.id;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.user.deleteMany({
        where: {
          email: {
            in: [
              adminEmail,
              nonAdminEmail,
              newUserEmail,
              auditLogUserEmail,
              otherSiteUserEmail,
            ],
          },
        },
      });
      await prisma.jobTitle.deleteMany({
        where: { name: { in: ['Poste Test E2E', 'Poste Test E2E Audit'] } },
      });
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
    await request(app.getHttpServer())
      .get('/auth/users')
      .set('Authorization', `Bearer ${sharedNonAdminToken}`)
      .expect(403);
  });

  it('parcours complet : création, première connexion forcée, changement de mot de passe, désactivation', async () => {
    const adminToken = sharedAdminToken;

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
    await request(app.getHttpServer())
      .delete(`/auth/users/${sharedAdminUserId}`)
      .set('Authorization', `Bearer ${sharedAdminToken}`)
      .expect(403);
  });

  it('empêche un administrateur de retirer son propre statut isSystemAdmin', async () => {
    await request(app.getHttpServer())
      .patch(`/auth/users/${sharedAdminUserId}`)
      .set('Authorization', `Bearer ${sharedAdminToken}`)
      .send({ isSystemAdmin: false })
      .expect(403);
  });

  describe('PATCH /auth/users/:id — modification des droits (rôle, isSystemAdmin)', () => {
    it("refuse à un utilisateur non-administrateur système la modification d'un compte", async () => {
      await request(app.getHttpServer())
        .patch(`/auth/users/${sharedNonAdminUserId}`)
        .set('Authorization', `Bearer ${sharedNonAdminToken}`)
        .send({ role: UserRole.DAF })
        .expect(403);
    });

    it('refuse une valeur de rôle qui ne fait pas partie des rôles existants (400)', async () => {
      await request(app.getHttpServer())
        .patch(`/auth/users/${sharedAdminUserId}`)
        .set('Authorization', `Bearer ${sharedAdminToken}`)
        .send({ role: 'ROLE_INEXISTANT' })
        .expect(400);
    });

    it("rejette tout champ non prévu par le DTO (400) — aucune permission personnalisée ne peut être introduite via l'API", async () => {
      await request(app.getHttpServer())
        .patch(`/auth/users/${sharedAdminUserId}`)
        .set('Authorization', `Bearer ${sharedAdminToken}`)
        .send({ modulePermissions: { catalog: 'FULL_ACCESS' } })
        .expect(400);
    });

    it("refuse à un administrateur de modifier un compte d'un autre site (404, jamais 200/403)", async () => {
      const otherSiteUser = await prisma.user.findUniqueOrThrow({
        where: { email: otherSiteUserEmail },
      });

      await request(app.getHttpServer())
        .patch(`/auth/users/${otherSiteUser.id}`)
        .set('Authorization', `Bearer ${sharedAdminToken}`)
        .send({ role: UserRole.RESPONSABLE_LABORATOIRE })
        .expect(404);

      // Le compte cible n'a pas été modifié.
      const untouched = await prisma.user.findUniqueOrThrow({
        where: { id: otherSiteUser.id },
      });
      expect(untouched.role).toBe(UserRole.DAF);
    });

    // Le cas "modification valide → succès, journalisée dans AuditLog avec avant/après"
    // est déjà couvert de bout en bout par le test `GET /auth/users/:id/audit-log`
    // "retourne 200 pour un administrateur..." ci-dessous (création + changement de rôle
    // + vérification de l'entrée UPDATE avant/après) : pas dupliqué ici.
  });

  describe('GET /auth/users/:id/audit-log', () => {
    it("refuse à un utilisateur non-administrateur système l'accès à l'historique d'un compte", async () => {
      // La cible importe peu ici : seul le rôle de l'appelant (non-admin) est testé.
      // On utilise son propre compte pour ne dépendre d'aucun autre test.
      await request(app.getHttpServer())
        .get(`/auth/users/${sharedNonAdminUserId}/audit-log`)
        .set('Authorization', `Bearer ${sharedNonAdminToken}`)
        .expect(403);
    });

    it('retourne 404 pour un compte inexistant, y compris pour un administrateur', async () => {
      await request(app.getHttpServer())
        .get('/auth/users/00000000-0000-0000-0000-000000000000/audit-log')
        .set('Authorization', `Bearer ${sharedAdminToken}`)
        .expect(404);
    });

    it("retourne 200 pour un administrateur, avec l'historique complet et correctement ordonné (le plus récent en premier)", async () => {
      const adminToken = sharedAdminToken;

      // 1. Fonction métier dédiée à ce test.
      const jobTitleResponse = await request(app.getHttpServer())
        .post('/auth/job-titles')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Poste Test E2E Audit' })
        .expect(201);
      const jobTitleId = (jobTitleResponse.body as { id: string }).id;

      // 2. Création du compte cible — génère une entrée CREATE.
      const createResponse = await request(app.getHttpServer())
        .post('/auth/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          fullName: 'Audit Log Test E2E',
          email: auditLogUserEmail,
          jobTitleId,
          role: UserRole.DAF,
        })
        .expect(201);
      const created = createResponse.body as CreatedUserResponseBody;
      const targetUserId = created.user.id;

      // 3. Modification du rôle — génère une entrée UPDATE.
      await request(app.getHttpServer())
        .patch(`/auth/users/${targetUserId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: UserRole.RESPONSABLE_LABORATOIRE })
        .expect(200);

      // 4. Consultation de l'historique par un administrateur.
      const auditLogResponse = await request(app.getHttpServer())
        .get(`/auth/users/${targetUserId}/audit-log`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const entries = auditLogResponse.body as Array<{
        id: string;
        action: string;
        before: { role?: string } | null;
        after: { role?: string } | null;
        createdAt: string;
        user: { id: string; fullName: string } | null;
      }>;

      expect(entries).toHaveLength(2);
      // La plus récente (UPDATE, changement de rôle) doit apparaître en premier.
      expect(entries[0].action).toBe('UPDATE');
      expect(entries[0].after?.role).toBe(UserRole.RESPONSABLE_LABORATOIRE);
      expect(entries[0].before?.role).toBe(UserRole.DAF);
      expect(entries[0].user?.fullName).toBe('Administrateur Test E2E');
      // La plus ancienne (CREATE) doit apparaître en dernier.
      expect(entries[1].action).toBe('CREATE');
      expect(entries[1].after?.role).toBe(UserRole.DAF);
      expect(new Date(entries[0].createdAt).getTime()).toBeGreaterThanOrEqual(
        new Date(entries[1].createdAt).getTime(),
      );
    });
  });
});
