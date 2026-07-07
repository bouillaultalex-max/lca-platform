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
