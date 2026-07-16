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

interface ArticlesPreviewResponseBody {
  importLogId: string;
  mappingComplete: boolean;
  mapping: {
    missingRequiredFields: string[];
    fields: {
      fieldKey: string;
      columnName: string | null;
      reason: string | null;
    }[];
  };
}

/**
 * Régression : `PreviewImportDto.mappingCorrections` (champ multipart JSON stringifié)
 * doit être converti en véritables instances `MappingCorrectionDto` par le `@Transform`
 * lui-même (via `plainToInstance`), pas seulement par un `@Type()` séparé — sinon
 * `ValidationPipe({ whitelist: true })` rejette la requête avec "property fieldKey
 * should not exist", détecté uniquement via ce test e2e (un test unitaire du service
 * ne passe jamais par le pipe de validation réel). Voir apps/api/src/import-export/dto/preview-import.dto.ts.
 */
describe('Import-export : correction de mapping en multipart (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const password = 'MotDePasseTest123!';
  const emails = {
    lab: 'e2e-import-lab@lca-mes.local',
    direction: 'e2e-import-direction@lca-mes.local',
  };
  const tokens: Record<'lab' | 'direction', string> = {
    lab: '',
    direction: '',
  };

  const csvBuffer = Buffer.from(
    'Reference,Designation,Type,Unite,Montant\nE2E-DTO-001,Article test e2e dto,Matiere premiere,L,9.99\n',
    'utf8',
  );

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
    };

    for (const key of Object.keys(emails) as Array<keyof typeof emails>) {
      await prisma.user.upsert({
        where: { email: emails[key] },
        update: { passwordHash, active: true },
        create: {
          siteId: site.id,
          fullName: `Utilisateur Test E2E Import (${key})`,
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
      await prisma.importLog.deleteMany({
        where: { fileName: 'e2e-dto-test.csv' },
      });
      await prisma.user.deleteMany({
        where: { email: { in: Object.values(emails) } },
      });
    }
    if (app) {
      await app.close();
    }
  });

  it('refuse DIRECTION (403)', () => {
    return request(app.getHttpServer())
      .post('/import-export/articles/preview')
      .set('Authorization', `Bearer ${tokens.direction}`)
      .attach('file', csvBuffer, 'e2e-dto-test.csv')
      .expect(403);
  });

  it("signale 'currentUnitCost' comme champ obligatoire manquant sans correction", async () => {
    const response = await request(app.getHttpServer())
      .post('/import-export/articles/preview')
      .set('Authorization', `Bearer ${tokens.lab}`)
      .attach('file', csvBuffer, 'e2e-dto-test.csv')
      .expect(201);

    const body = response.body as ArticlesPreviewResponseBody;
    expect(body.mappingComplete).toBe(false);
    expect(body.mapping.missingRequiredFields).toContain('currentUnitCost');
  });

  it('applique une correction de mapping envoyée en multipart (JSON stringifié)', async () => {
    const response = await request(app.getHttpServer())
      .post('/import-export/articles/preview')
      .set('Authorization', `Bearer ${tokens.lab}`)
      .attach('file', csvBuffer, 'e2e-dto-test.csv')
      .field(
        'mappingCorrections',
        JSON.stringify([
          { fieldKey: 'currentUnitCost', columnName: 'Montant' },
        ]),
      )
      .expect(201);

    const body = response.body as ArticlesPreviewResponseBody;
    expect(body.mappingComplete).toBe(true);
    expect(body.mapping.missingRequiredFields).toEqual([]);
    const field = body.mapping.fields.find(
      (f) => f.fieldKey === 'currentUnitCost',
    );
    expect(field?.columnName).toBe('Montant');
    expect(field?.reason).toContain('corrigée manuellement');
  });

  it('rejette une correction malformée (champ inconnu) avec un message explicite', () => {
    return request(app.getHttpServer())
      .post('/import-export/articles/preview')
      .set('Authorization', `Bearer ${tokens.lab}`)
      .attach('file', csvBuffer, 'e2e-dto-test.csv')
      .field(
        'mappingCorrections',
        JSON.stringify([{ fieldKey: 'currentUnitCost' }]),
      )
      .expect(400);
  });
});

interface ArticleImportRowWithDiffBody {
  line: number;
  openSiReference: string;
  type: string;
  name: string;
  unitOfMeasure: string;
  currentUnitCost: number;
  articleId: string;
  changes: { field: string; label: string; before: unknown; after: unknown }[];
}

interface ArticlesFullPreviewResponseBody {
  importLogId: string;
  mappingComplete: boolean;
  toUpdate: ArticleImportRowWithDiffBody[];
}

/**
 * Régression du bug décrit dans docs/feedback : la confirmation d'une mise à jour
 * d'article échouait toujours en 400, car le frontend renvoyait tel quel l'objet de
 * prévisualisation (`toUpdate`), qui porte `articleId`/`changes` en plus des six
 * champs métier attendus par `ArticleImportRowDto`. `forbidNonWhitelisted: true`
 * s'applique récursivement aux lignes de `rows` (`@ValidateNested`) : ces deux
 * propriétés en trop faisaient rejeter toute la requête, avant même d'atteindre
 * `ArticlesImportService.confirm()`. Un test unitaire du service ne peut pas
 * reproduire ce rejet puisqu'il ne passe jamais par le `ValidationPipe` réel.
 */
describe('Import-export : confirmation de mise à jour d’articles (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const password = 'MotDePasseTest123!';
  const email = 'e2e-import-confirm-lab@lca-mes.local';
  let token = '';
  let siteId = '';

  const openSiReference = 'MP-E2E-CONFIRM-001';
  const csvBuffer = Buffer.from(
    `Reference,Designation,Type,Unite,Prix\n${openSiReference},Parfum ambiance lavande e2e,Matiere premiere,KG,13.2\n`,
    'utf8',
  );

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
    siteId = site.id;
    const passwordHash = await bcrypt.hash(password, 4);

    await prisma.user.upsert({
      where: { email },
      update: { passwordHash, active: true },
      create: {
        siteId,
        fullName: 'Utilisateur Test E2E Confirmation Import',
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

  beforeEach(async () => {
    await prisma.article.deleteMany({ where: { openSiReference } });
    await prisma.article.create({
      data: {
        siteId,
        type: 'MATIERE_PREMIERE',
        openSiReference,
        name: 'Parfum ambiance lavande',
        unitOfMeasure: 'L',
        currentUnitCost: 13.2,
      },
    });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.article.deleteMany({ where: { openSiReference } });
      await prisma.importLog.deleteMany({
        where: { fileName: 'e2e-confirm-test.csv' },
      });
      await prisma.user.deleteMany({ where: { email } });
    }
    if (app) {
      await app.close();
    }
  });

  it("confirme une mise à jour d'unité de mesure quand le payload est réduit aux six champs attendus (200, valeur persistée)", async () => {
    const previewResponse = await request(app.getHttpServer())
      .post('/import-export/articles/preview')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', csvBuffer, 'e2e-confirm-test.csv')
      .expect(201);

    const preview = previewResponse.body as ArticlesFullPreviewResponseBody;
    expect(preview.mappingComplete).toBe(true);
    expect(preview.toUpdate).toHaveLength(1);
    const previewRow = preview.toUpdate[0];
    expect(previewRow.articleId).toBeTruthy();
    expect(previewRow.changes.some((c) => c.field === 'unitOfMeasure')).toBe(
      true,
    );

    // Mapping explicite attendu côté frontend (voir apps/web/src/pages/imports/articlesConfirmRow.ts) :
    // seuls les six champs métier du DTO, jamais articleId/changes.
    const confirmResponse = await request(app.getHttpServer())
      .post('/import-export/articles/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({
        importLogId: preview.importLogId,
        rows: [
          {
            line: previewRow.line,
            openSiReference: previewRow.openSiReference,
            type: previewRow.type,
            name: previewRow.name,
            unitOfMeasure: previewRow.unitOfMeasure,
            currentUnitCost: previewRow.currentUnitCost,
          },
        ],
      })
      .expect(200);

    expect(confirmResponse.body).toMatchObject({
      created: 0,
      updated: 1,
      errors: [],
    });

    const updatedArticle = await prisma.article.findUnique({
      where: { id: previewRow.articleId },
    });
    expect(updatedArticle?.unitOfMeasure).toBe('KG');
  });

  it('rejette (400) une confirmation dont une ligne contient articleId ou changes : forbidNonWhitelisted reste intentionnel', async () => {
    const previewResponse = await request(app.getHttpServer())
      .post('/import-export/articles/preview')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', csvBuffer, 'e2e-confirm-test.csv')
      .expect(201);

    const preview = previewResponse.body as ArticlesFullPreviewResponseBody;
    const previewRow = preview.toUpdate[0];

    await request(app.getHttpServer())
      .post('/import-export/articles/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({
        importLogId: preview.importLogId,
        // Reproduction exacte du bug corrigé : la ligne de prévisualisation brute,
        // avec articleId/changes, est renvoyée telle quelle à la confirmation.
        rows: [previewRow],
      })
      .expect(400);

    // L'article n'a pas dû être modifié : la requête entière a été rejetée par le pipe.
    const untouchedArticle = await prisma.article.findUnique({
      where: { id: previewRow.articleId },
    });
    expect(untouchedArticle?.unitOfMeasure).toBe('L');
  });
});
