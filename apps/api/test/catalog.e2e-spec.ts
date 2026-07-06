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

/**
 * Vérifie que le module catalog (Article/Machine/Recipe) est bien réservé aux
 * rôles à accès complet — DIRECTION/DAF n'ont aucun accès, pas même en lecture
 * (voir docs/regles-metier.md §1).
 */
describe('Catalog (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const password = 'MotDePasseTest123!';
  const emails = {
    lab: 'e2e-catalog-lab@lca-mes.local',
    direction: 'e2e-catalog-direction@lca-mes.local',
    daf: 'e2e-catalog-daf@lca-mes.local',
  };
  const tokens: Record<'lab' | 'direction' | 'daf', string> = {
    lab: '',
    direction: '',
    daf: '',
  };
  const testOpenSiReferencePrefix = 'E2E-CATALOG-TEST-';

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
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.article.deleteMany({
        where: { openSiReference: { startsWith: testOpenSiReferencePrefix } },
      });
      await prisma.user.deleteMany({
        where: { email: { in: Object.values(emails) } },
      });
    }
    if (app) {
      await app.close();
    }
  });

  describe('GET /catalog/articles', () => {
    it('refuse une requête sans token (401)', () => {
      return request(app.getHttpServer()).get('/catalog/articles').expect(401);
    });

    it('autorise RESPONSABLE_LABORATOIRE (200)', () => {
      return request(app.getHttpServer())
        .get('/catalog/articles')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .expect(200);
    });

    it('refuse DIRECTION même en lecture seule (403)', () => {
      return request(app.getHttpServer())
        .get('/catalog/articles')
        .set('Authorization', `Bearer ${tokens.direction}`)
        .expect(403);
    });

    it('refuse DAF même en lecture seule (403)', () => {
      return request(app.getHttpServer())
        .get('/catalog/articles')
        .set('Authorization', `Bearer ${tokens.daf}`)
        .expect(403);
    });
  });

  describe('POST /catalog/articles', () => {
    it('autorise RESPONSABLE_LABORATOIRE à créer un article (201)', () => {
      return request(app.getHttpServer())
        .post('/catalog/articles')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({
          type: 'MATIERE_PREMIERE',
          openSiReference: `${testOpenSiReferencePrefix}MP`,
          name: 'Article de test e2e',
          unitOfMeasure: 'L',
          currentUnitCost: 1,
        })
        .expect(201);
    });

    it('refuse DIRECTION (403)', () => {
      return request(app.getHttpServer())
        .post('/catalog/articles')
        .set('Authorization', `Bearer ${tokens.direction}`)
        .send({
          type: 'MATIERE_PREMIERE',
          openSiReference: `${testOpenSiReferencePrefix}REJECTED`,
          name: 'Ne devrait jamais être créé',
          unitOfMeasure: 'L',
          currentUnitCost: 1,
        })
        .expect(403);
    });
  });

  describe('GET /catalog/machines', () => {
    it('autorise RESPONSABLE_LABORATOIRE (200)', () => {
      return request(app.getHttpServer())
        .get('/catalog/machines')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .expect(200);
    });

    it('refuse DAF (403)', () => {
      return request(app.getHttpServer())
        .get('/catalog/machines')
        .set('Authorization', `Bearer ${tokens.daf}`)
        .expect(403);
    });
  });

  describe('GET /catalog/recipes', () => {
    it('autorise RESPONSABLE_LABORATOIRE (200)', () => {
      return request(app.getHttpServer())
        .get('/catalog/recipes')
        .query({ finishedProductId: '00000000-0000-0000-0000-000000000000' })
        .set('Authorization', `Bearer ${tokens.lab}`)
        .expect(200);
    });

    it('refuse DIRECTION avant même la validation des paramètres (403, pas 400)', () => {
      return request(app.getHttpServer())
        .get('/catalog/recipes')
        .set('Authorization', `Bearer ${tokens.direction}`)
        .expect(403);
    });
  });
});
