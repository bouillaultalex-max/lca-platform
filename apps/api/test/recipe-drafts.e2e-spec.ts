import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import * as bcrypt from 'bcryptjs';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ArticleType, UserRole } from '../generated/prisma/client';

interface LoginResponseBody {
  accessToken: string;
}

interface RecipeDraftBody {
  id: string;
  content: { format: number | null; lines: unknown[] };
  updatedAt: string;
}

/**
 * Brouillons de recettes (voir docs/adr/0004-brouillons-recettes.md) : un seul
 * brouillon par utilisateur et par produit fini, aucune donnée de brouillon ne doit
 * jamais apparaître dans les recettes officielles, et la création finale d'une
 * recette doit effacer le brouillon correspondant.
 */
describe('Recipe drafts (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const password = 'MotDePasseTest123!';
  const emails = {
    lab: 'e2e-recipe-drafts-lab@lca-mes.local',
    lab2: 'e2e-recipe-drafts-lab2@lca-mes.local',
    direction: 'e2e-recipe-drafts-direction@lca-mes.local',
    daf: 'e2e-recipe-drafts-daf@lca-mes.local',
  };
  const tokens: Record<keyof typeof emails, string> = {
    lab: '',
    lab2: '',
    direction: '',
    daf: '',
  };
  const testOpenSiReferencePrefix = 'E2E-RECIPE-DRAFT-TEST-';
  let finishedProductId: string;

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
      lab2: UserRole.RESPONSABLE_LABORATOIRE,
      direction: UserRole.DIRECTION,
      daf: UserRole.DAF,
    };

    for (const key of Object.keys(emails) as Array<keyof typeof emails>) {
      await prisma.user.upsert({
        where: { email: emails[key] },
        update: { passwordHash, active: true },
        create: {
          siteId: site.id,
          fullName: `Utilisateur Test E2E Brouillons (${key})`,
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

    const finishedProduct = await prisma.article.create({
      data: {
        siteId: site.id,
        type: ArticleType.PRODUIT_FINI,
        openSiReference: `${testOpenSiReferencePrefix}PF`,
        name: 'Produit fini de test e2e brouillons',
        unitOfMeasure: 'unité',
        currentUnitCost: 0,
      },
    });
    finishedProductId = finishedProduct.id;
  });

  afterEach(async () => {
    await prisma.recipeDraft.deleteMany({ where: { finishedProductId } });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.recipeLine.deleteMany({
        where: { recipe: { finishedProductId } },
      });
      await prisma.recipe.deleteMany({ where: { finishedProductId } });
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

  describe('GET /catalog/recipes/drafts', () => {
    it('refuse une requête sans token (401)', () => {
      return request(app.getHttpServer())
        .get('/catalog/recipes/drafts')
        .query({ finishedProductId })
        .expect(401);
    });

    it('refuse DIRECTION et DAF (403)', async () => {
      await request(app.getHttpServer())
        .get('/catalog/recipes/drafts')
        .query({ finishedProductId })
        .set('Authorization', `Bearer ${tokens.direction}`)
        .expect(403);
      await request(app.getHttpServer())
        .get('/catalog/recipes/drafts')
        .query({ finishedProductId })
        .set('Authorization', `Bearer ${tokens.daf}`)
        .expect(403);
    });

    it('retourne 204 sans contenu quand aucun brouillon n’existe (état normal)', () => {
      return request(app.getHttpServer())
        .get('/catalog/recipes/drafts')
        .query({ finishedProductId })
        .set('Authorization', `Bearer ${tokens.lab}`)
        .expect(204);
    });
  });

  describe('PUT /catalog/recipes/drafts', () => {
    it('crée puis met à jour le même brouillon (pas de doublon) pour un utilisateur/produit donné', async () => {
      const created = await request(app.getHttpServer())
        .put('/catalog/recipes/drafts')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({
          finishedProductId,
          format: 100,
          lines: [{ articleId: '', quantityPerUnit: '', unit: '' }],
        })
        .expect(200);
      const draftId = (created.body as RecipeDraftBody).id;

      const updated = await request(app.getHttpServer())
        .put('/catalog/recipes/drafts')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({
          finishedProductId,
          format: 100,
          lines: [{ articleId: 'mp-1', quantityPerUnit: '45', unit: '%' }],
        })
        .expect(200);

      expect((updated.body as RecipeDraftBody).id).toBe(draftId);
      expect((updated.body as RecipeDraftBody).content.lines).toEqual([
        { articleId: 'mp-1', quantityPerUnit: '45', unit: '%' },
      ]);

      const count = await prisma.recipeDraft.count({
        where: { finishedProductId },
      });
      expect(count).toBe(1);
    });

    it('isole les brouillons par utilisateur : lab2 ne voit pas le brouillon de lab', async () => {
      await request(app.getHttpServer())
        .put('/catalog/recipes/drafts')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({ finishedProductId, format: 100, lines: [] })
        .expect(200);

      await request(app.getHttpServer())
        .get('/catalog/recipes/drafts')
        .query({ finishedProductId })
        .set('Authorization', `Bearer ${tokens.lab2}`)
        .expect(204);
    });

    it('accepte des lignes incomplètes/invalides sans erreur de validation', () => {
      return request(app.getHttpServer())
        .put('/catalog/recipes/drafts')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({ finishedProductId, format: null, lines: [{}] })
        .expect(200);
    });

    it('détecte un conflit si expectedUpdatedAt est périmé (409), et laisse forcer (200)', async () => {
      const first = await request(app.getHttpServer())
        .put('/catalog/recipes/drafts')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({ finishedProductId, format: 100, lines: [] })
        .expect(200);
      const staleUpdatedAt = (first.body as RecipeDraftBody).updatedAt;

      // Un autre onglet/poste modifie le brouillon entre-temps.
      await request(app.getHttpServer())
        .put('/catalog/recipes/drafts')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({ finishedProductId, format: 200, lines: [] })
        .expect(200);

      await request(app.getHttpServer())
        .put('/catalog/recipes/drafts')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({
          finishedProductId,
          format: 300,
          lines: [],
          expectedUpdatedAt: staleUpdatedAt,
        })
        .expect(409);

      await request(app.getHttpServer())
        .put('/catalog/recipes/drafts')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({
          finishedProductId,
          format: 300,
          lines: [],
          expectedUpdatedAt: staleUpdatedAt,
          force: true,
        })
        .expect(200);
    });
  });

  describe('DELETE /catalog/recipes/drafts/:id', () => {
    it('supprime le brouillon, un GET ultérieur retourne null', async () => {
      const created = await request(app.getHttpServer())
        .put('/catalog/recipes/drafts')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({ finishedProductId, format: 100, lines: [] })
        .expect(200);

      await request(app.getHttpServer())
        .delete(
          `/catalog/recipes/drafts/${(created.body as RecipeDraftBody).id}`,
        )
        .set('Authorization', `Bearer ${tokens.lab}`)
        .expect(204);

      await request(app.getHttpServer())
        .get('/catalog/recipes/drafts')
        .query({ finishedProductId })
        .set('Authorization', `Bearer ${tokens.lab}`)
        .expect(204);
    });

    it('refuse de supprimer le brouillon d’un autre utilisateur (404)', async () => {
      const created = await request(app.getHttpServer())
        .put('/catalog/recipes/drafts')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({ finishedProductId, format: 100, lines: [] })
        .expect(200);

      await request(app.getHttpServer())
        .delete(
          `/catalog/recipes/drafts/${(created.body as RecipeDraftBody).id}`,
        )
        .set('Authorization', `Bearer ${tokens.lab2}`)
        .expect(404);
    });
  });

  describe('Cycle complet : brouillon → création finale', () => {
    it('la création réussie de la recette efface le brouillon correspondant', async () => {
      await request(app.getHttpServer())
        .put('/catalog/recipes/drafts')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({
          finishedProductId,
          format: 100,
          lines: [{ articleId: '', quantityPerUnit: '', unit: '' }],
        })
        .expect(200);

      const matierePremiere = await prisma.article.create({
        data: {
          siteId: (
            await prisma.article.findUniqueOrThrow({
              where: { id: finishedProductId },
            })
          ).siteId,
          type: ArticleType.MATIERE_PREMIERE,
          openSiReference: `${testOpenSiReferencePrefix}MP`,
          name: 'Matière première de test e2e brouillons',
          unitOfMeasure: 'L',
          currentUnitCost: 1,
        },
      });

      await request(app.getHttpServer())
        .post('/catalog/recipes')
        .set('Authorization', `Bearer ${tokens.lab}`)
        .send({
          finishedProductId,
          format: 100,
          lines: [
            { articleId: matierePremiere.id, quantityPerUnit: 100, unit: '%' },
          ],
        })
        .expect(201);

      await request(app.getHttpServer())
        .get('/catalog/recipes/drafts')
        .query({ finishedProductId })
        .set('Authorization', `Bearer ${tokens.lab}`)
        .expect(204);

      await prisma.recipeLine.deleteMany({
        where: { articleId: matierePremiere.id },
      });
      await prisma.recipe.deleteMany({ where: { finishedProductId } });
      await prisma.article.delete({ where: { id: matierePremiere.id } });
    });
  });
});
