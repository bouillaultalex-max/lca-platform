import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import * as bcrypt from 'bcryptjs';
import * as XLSX from 'xlsx';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ImportStatus, ImportType, UserRole } from '../generated/prisma/client';

interface LoginResponseBody {
  accessToken: string;
}

interface AromaSampleRowBody {
  line: number;
  legacyId: string;
  supplierNameRaw: string;
  productName: string;
  supplierReference: string | null;
  category: string;
  rating: number | null;
  stockGrams: number | null;
  pricePerKgEur: number | null;
  addedAt: string | null;
  comment: string | null;
  status: 'create' | 'update' | 'unchanged';
  sampleId: string | null;
  changes: { field: string; label: string; before: unknown; after: unknown }[];
}

interface AromaSamplesPreviewResponseBody {
  importLogId: string;
  mappingComplete: boolean;
  mapping: { missingRequiredFields: string[] };
  rows?: AromaSampleRowBody[];
  toCreate?: number;
  toUpdate?: number;
  unchanged?: number;
  warnings?: {
    line: number;
    legacyId: string;
    kind: string;
    message: string;
  }[];
  errors?: { line: number; legacyId?: string; message: string }[];
}

interface AromaSamplesConfirmResponseBody {
  importLogId: string;
  created: number;
  updated: number;
  unchanged: number;
  errors: { line: number; legacyId?: string; message: string }[];
}

/** Nom exact de la feuille source attendue par `AromaSamplesImportService` (voir RD-01B). */
const AROMATHEQUE_SHEET_NAME = '🗂 Aromatèque Complète';

/** En-têtes réels reconnus par `AROMA_SAMPLE_MAPPING_CONFIG`, sans correction manuelle nécessaire. */
const AROMA_HEADERS = [
  'EF-0378',
  'Fournisseur',
  'Produit / Arôme',
  'Référence',
  'Catégorie',
  'Note ★',
  'Stock (g)',
  'Prix/kg (€)',
  'Date ajout',
  'Commentaire',
];

interface AromaSampleFixtureRow {
  legacyId: string;
  supplierNameRaw: string;
  productName: string | null;
  supplierReference?: string | null;
  category?: string | null;
  rating?: number | null;
  stockGrams?: number | null;
  pricePerKgEur?: number | null;
  addedAt?: string | null;
  comment?: string | null;
}

/**
 * Construit un classeur XLSX synthétique en mémoire (jamais de fichier réel ni de
 * chemin local), sur le même patron que `import-parser.service.spec.ts`. `sheetName`
 * permet de reproduire volontairement une feuille absente (scénario 9).
 */
function buildAromathequeXlsxBuffer(
  rows: AromaSampleFixtureRow[],
  sheetName: string = AROMATHEQUE_SHEET_NAME,
): Buffer {
  const sheetRows = rows.map((row) => ({
    'EF-0378': row.legacyId,
    Fournisseur: row.supplierNameRaw,
    'Produit / Arôme': row.productName ?? null,
    Référence: row.supplierReference ?? null,
    Catégorie: row.category ?? null,
    'Note ★': row.rating ?? null,
    'Stock (g)': row.stockGrams ?? null,
    'Prix/kg (€)': row.pricePerKgEur ?? null,
    'Date ajout': row.addedAt ?? null,
    Commentaire: row.comment ?? null,
  }));
  const worksheet = XLSX.utils.json_to_sheet(sheetRows, {
    header: AROMA_HEADERS,
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/**
 * Réduit une ligne de prévisualisation aux seuls champs attendus par
 * `AromaSampleImportRowDto` : `status`/`sampleId`/`changes` ne font pas partie du DTO
 * de confirmation et feraient rejeter la requête par `forbidNonWhitelisted: true`
 * (même piège que celui couvert par `import-export.e2e-spec.ts` pour les articles).
 */
function toConfirmRow(row: AromaSampleRowBody) {
  return {
    line: row.line,
    legacyId: row.legacyId,
    supplierNameRaw: row.supplierNameRaw,
    productName: row.productName,
    supplierReference: row.supplierReference,
    category: row.category,
    rating: row.rating,
    stockGrams: row.stockGrams,
    pricePerKgEur: row.pricePerKgEur,
    addedAt: row.addedAt,
    comment: row.comment,
  };
}

/**
 * Parcours HTTP complet de l'import Aromathèque (RD-01C-5) : véritable pipeline
 * NestJS + base de test réelle (voir `setup-env.ts`, `.env.test`), aucun mock du
 * service métier. Tous les fichiers sont des classeurs XLSX synthétiques générés en
 * mémoire (voir `buildAromathequeXlsxBuffer`) — jamais le fichier Excel réel de
 * l'aromathèque, jamais de chemin sur disque.
 */
describe('Aromathèque import — prévisualisation (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let siteId: string;

  const password = 'MotDePasseTest123!';
  const emails = {
    lab: 'e2e-aroma-preview-lab@lca-mes.local',
    daf: 'e2e-aroma-preview-daf@lca-mes.local',
  };
  const tokens: Record<'lab' | 'daf', string> = { lab: '', daf: '' };

  const fileNames = {
    ok: 'e2e-aroma-preview-ok.xlsx',
    permission: 'e2e-aroma-preview-permission.xlsx',
    invalidRow: 'e2e-aroma-preview-invalid-row.xlsx',
    missingSheet: 'e2e-aroma-preview-missing-sheet.xlsx',
  };
  const legacyIds = ['E2E-AROMA-PREVIEW-OK', 'E2E-AROMA-PREVIEW-VALID'];

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

    const roleByKey: Record<keyof typeof emails, UserRole> = {
      lab: UserRole.RESPONSABLE_LABORATOIRE,
      daf: UserRole.DAF,
    };

    for (const key of Object.keys(emails) as Array<keyof typeof emails>) {
      await prisma.user.upsert({
        where: { email: emails[key] },
        update: { passwordHash, active: true, siteId },
        create: {
          siteId,
          fullName: `Utilisateur Test E2E Aromathèque (${key})`,
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
      await prisma.rndAromaSample.deleteMany({
        where: { siteId, legacyId: { in: legacyIds } },
      });
      await prisma.importLog.deleteMany({
        where: { fileName: { in: Object.values(fileNames) } },
      });
      await prisma.user.deleteMany({
        where: { email: { in: Object.values(emails) } },
      });
    }
    if (app) {
      await app.close();
    }
  });

  it('prévisualise un import valide : feuille sélectionnée, mapping complet, ImportLog créé avec previewHash, aucune écriture RndAromaSample', async () => {
    const buffer = buildAromathequeXlsxBuffer([
      {
        legacyId: legacyIds[0],
        supplierNameRaw: 'Fournisseur E2E',
        productName: 'Vanille E2E',
        supplierReference: 'REF-E2E-PREVIEW',
        category: 'Vanille',
        rating: 4,
        stockGrams: 250,
        pricePerKgEur: 89.5,
        addedAt: '2026-07-06',
        comment: 'Commentaire e2e',
      },
    ]);

    const response = await request(app.getHttpServer())
      .post('/rnd/aroma-samples/import/preview')
      .set('Authorization', `Bearer ${tokens.lab}`)
      .attach('file', buffer, fileNames.ok)
      .expect(201);

    const body = response.body as AromaSamplesPreviewResponseBody;
    expect(body.mappingComplete).toBe(true);
    expect(body.mapping.missingRequiredFields).toEqual([]);
    expect(body.rows).toHaveLength(1);
    expect(body.rows?.[0]).toMatchObject({
      legacyId: legacyIds[0],
      status: 'create',
    });
    expect(body.toCreate).toBe(1);
    expect(body.errors).toEqual([]);

    const importLog = await prisma.importLog.findUnique({
      where: { id: body.importLogId },
    });
    expect(importLog).toMatchObject({
      siteId,
      type: ImportType.AROMATHEQUE,
      status: ImportStatus.PREVISUALISE,
      fileName: fileNames.ok,
    });
    expect(importLog?.previewHash).toMatch(/^[0-9a-f]{64}$/);

    const sampleCount = await prisma.rndAromaSample.count({
      where: { siteId, legacyId: legacyIds[0] },
    });
    expect(sampleCount).toBe(0);
  });

  it('refuse un utilisateur DAF (403) et ne crée aucun ImportLog', async () => {
    const buffer = buildAromathequeXlsxBuffer([
      {
        legacyId: 'E2E-AROMA-PREVIEW-DAF',
        supplierNameRaw: 'Fournisseur E2E',
        productName: 'Produit E2E',
      },
    ]);

    await request(app.getHttpServer())
      .post('/rnd/aroma-samples/import/preview')
      .set('Authorization', `Bearer ${tokens.daf}`)
      .attach('file', buffer, fileNames.permission)
      .expect(403);

    const count = await prisma.importLog.count({
      where: { fileName: fileNames.permission },
    });
    expect(count).toBe(0);
  });

  it('signale en erreur la ligne sans productName et ne rend confirmable que la ligne valide', async () => {
    const buffer = buildAromathequeXlsxBuffer([
      {
        legacyId: 'E2E-AROMA-PREVIEW-INVALID',
        supplierNameRaw: 'Fournisseur E2E',
        productName: null,
      },
      {
        legacyId: legacyIds[1],
        supplierNameRaw: 'Fournisseur E2E',
        productName: 'Produit valide E2E',
      },
    ]);

    const response = await request(app.getHttpServer())
      .post('/rnd/aroma-samples/import/preview')
      .set('Authorization', `Bearer ${tokens.lab}`)
      .attach('file', buffer, fileNames.invalidRow)
      .expect(201);

    const body = response.body as AromaSamplesPreviewResponseBody;
    expect(body.errors).toHaveLength(1);
    expect(body.errors?.[0].message).toContain('Produit / arôme manquant');
    expect(body.rows).toHaveLength(1);
    expect(body.rows?.[0].legacyId).toBe(legacyIds[1]);
  });

  it('rejette (400) un fichier sans la feuille "🗂 Aromatèque Complète", sans jamais lire une autre feuille', async () => {
    const buffer = buildAromathequeXlsxBuffer(
      [
        {
          legacyId: 'E2E-AROMA-PREVIEW-OTHER-SHEET',
          supplierNameRaw: 'Fournisseur E2E',
          productName: 'Produit E2E',
        },
      ],
      'Autre feuille',
    );

    const response = await request(app.getHttpServer())
      .post('/rnd/aroma-samples/import/preview')
      .set('Authorization', `Bearer ${tokens.lab}`)
      .attach('file', buffer, fileNames.missingSheet)
      .expect(400);

    const body = response.body as { message?: string };
    expect(body.message).toContain('introuvable');

    const count = await prisma.importLog.count({
      where: { fileName: fileNames.missingSheet },
    });
    expect(count).toBe(0);
  });
});

describe('Aromathèque import — isolation par site (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let siteAId: string;
  let siteBId: string;

  const password = 'MotDePasseTest123!';
  const emails = {
    a: 'e2e-aroma-isolation-a@lca-mes.local',
    b: 'e2e-aroma-isolation-b@lca-mes.local',
  };
  const tokens: Record<'a' | 'b', string> = { a: '', b: '' };

  const fileNames = {
    a: 'e2e-aroma-isolation-a.xlsx',
    b: 'e2e-aroma-isolation-b.xlsx',
  };
  const sharedLegacyId = 'E2E-AROMA-ISOLATION-SHARED';

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

    const siteA = await prisma.site.create({
      data: { name: 'Site e2e aromathèque A' },
    });
    const siteB = await prisma.site.create({
      data: { name: 'Site e2e aromathèque B' },
    });
    siteAId = siteA.id;
    siteBId = siteB.id;

    const passwordHash = await bcrypt.hash(password, 4);

    await prisma.user.upsert({
      where: { email: emails.a },
      update: { passwordHash, active: true, siteId: siteAId },
      create: {
        siteId: siteAId,
        fullName: 'Utilisateur Test E2E Aromathèque (site A)',
        email: emails.a,
        passwordHash,
        role: UserRole.RESPONSABLE_LABORATOIRE,
      },
    });
    await prisma.user.upsert({
      where: { email: emails.b },
      update: { passwordHash, active: true, siteId: siteBId },
      create: {
        siteId: siteBId,
        fullName: 'Utilisateur Test E2E Aromathèque (site B)',
        email: emails.b,
        passwordHash,
        role: UserRole.RESPONSABLE_LABORATOIRE,
      },
    });

    const loginA = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: emails.a, password });
    tokens.a = (loginA.body as LoginResponseBody).accessToken;
    const loginB = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: emails.b, password });
    tokens.b = (loginB.body as LoginResponseBody).accessToken;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.rndAromaSample.deleteMany({
        where: { siteId: { in: [siteAId, siteBId] } },
      });
      await prisma.importLog.deleteMany({
        where: { siteId: { in: [siteAId, siteBId] } },
      });
      await prisma.user.deleteMany({
        where: { email: { in: Object.values(emails) } },
      });
      await prisma.site.deleteMany({
        where: { id: { in: [siteAId, siteBId] } },
      });
    }
    if (app) {
      await app.close();
    }
  });

  it('chaque prévisualisation ne classe que contre les échantillons de son propre site : même legacyId, aucune fuite inter-site', async () => {
    // Site A : preview + confirm -> crée l'échantillon sur le site A uniquement.
    const previewA = await request(app.getHttpServer())
      .post('/rnd/aroma-samples/import/preview')
      .set('Authorization', `Bearer ${tokens.a}`)
      .attach(
        'file',
        buildAromathequeXlsxBuffer([
          {
            legacyId: sharedLegacyId,
            supplierNameRaw: 'Fournisseur Site A',
            productName: 'Produit Site A',
            category: 'Vanille',
          },
        ]),
        fileNames.a,
      )
      .expect(201);
    const bodyA = previewA.body as AromaSamplesPreviewResponseBody;
    expect(bodyA.rows).toHaveLength(1);
    const rowA = bodyA.rows![0];
    expect(rowA.status).toBe('create');

    await request(app.getHttpServer())
      .post('/rnd/aroma-samples/import/confirm')
      .set('Authorization', `Bearer ${tokens.a}`)
      .send({ importLogId: bodyA.importLogId, rows: [toConfirmRow(rowA)] })
      .expect(200);

    // Site B : même legacyId, valeurs différentes -> classé "create" (pas "update"),
    // preuve que le site B ne voit pas l'échantillon créé sur le site A.
    const previewB = await request(app.getHttpServer())
      .post('/rnd/aroma-samples/import/preview')
      .set('Authorization', `Bearer ${tokens.b}`)
      .attach(
        'file',
        buildAromathequeXlsxBuffer([
          {
            legacyId: sharedLegacyId,
            supplierNameRaw: 'Fournisseur Site B',
            productName: 'Produit Site B',
            category: 'Agrumes',
          },
        ]),
        fileNames.b,
      )
      .expect(201);
    const bodyB = previewB.body as AromaSamplesPreviewResponseBody;
    expect(bodyB.rows).toHaveLength(1);
    expect(bodyB.rows?.[0]).toMatchObject({ status: 'create', sampleId: null });

    const sampleA = await prisma.rndAromaSample.findFirst({
      where: { siteId: siteAId, legacyId: sharedLegacyId },
    });
    expect(sampleA).toBeTruthy();
    expect(sampleA?.productName).toBe('Produit Site A');

    const samplesOnSiteB = await prisma.rndAromaSample.findMany({
      where: { siteId: siteBId },
    });
    expect(samplesOnSiteB).toHaveLength(0);
  });
});

describe('Aromathèque import — confirmation (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let siteId: string;

  const password = 'MotDePasseTest123!';
  const email = 'e2e-aroma-confirm-lab@lca-mes.local';
  let token = '';

  const fileNames = {
    ok: 'e2e-aroma-confirm-ok.xlsx',
    altered: 'e2e-aroma-confirm-altered.xlsx',
    double: 'e2e-aroma-confirm-double.xlsx',
    reimport: 'e2e-aroma-confirm-reimport.xlsx',
  };
  const legacyIds = {
    ok: 'E2E-AROMA-CONFIRM-OK',
    altered: 'E2E-AROMA-CONFIRM-ALTERED',
    double: 'E2E-AROMA-CONFIRM-DOUBLE',
    reimport: 'E2E-AROMA-CONFIRM-REIMPORT',
  };

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
      update: { passwordHash, active: true, siteId },
      create: {
        siteId,
        fullName: 'Utilisateur Test E2E Aromathèque Confirmation',
        email,
        passwordHash,
        role: UserRole.RESPONSABLE_ADJOINT,
      },
    });

    const loginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password });
    token = (loginResponse.body as LoginResponseBody).accessToken;
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.rndAromaSample.deleteMany({
        where: { siteId, legacyId: { in: Object.values(legacyIds) } },
      });
      await prisma.importLog.deleteMany({
        where: { fileName: { in: Object.values(fileNames) } },
      });
      await prisma.user.deleteMany({ where: { email } });
    }
    if (app) {
      await app.close();
    }
  });

  async function preview(
    buffer: Buffer,
    fileName: string,
  ): Promise<AromaSamplesPreviewResponseBody> {
    const response = await request(app.getHttpServer())
      .post('/rnd/aroma-samples/import/preview')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', buffer, fileName)
      .expect(201);
    return response.body as AromaSamplesPreviewResponseBody;
  }

  it('confirme la création : RndAromaSample créé avec importLogId, ImportLog passé à VALIDE', async () => {
    const row: AromaSampleFixtureRow = {
      legacyId: legacyIds.ok,
      supplierNameRaw: 'Fournisseur E2E',
      productName: 'Produit E2E',
      category: 'Vanille',
      rating: 4,
      stockGrams: 250,
      pricePerKgEur: 89.5,
      addedAt: '2026-07-06',
      comment: 'Commentaire e2e',
    };
    const body = await preview(buildAromathequeXlsxBuffer([row]), fileNames.ok);
    expect(body.rows).toHaveLength(1);
    const previewRow = body.rows![0];

    const confirmResponse = await request(app.getHttpServer())
      .post('/rnd/aroma-samples/import/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({
        importLogId: body.importLogId,
        rows: [toConfirmRow(previewRow)],
      })
      .expect(200);

    const confirmBody = confirmResponse.body as AromaSamplesConfirmResponseBody;
    expect(confirmBody).toMatchObject({
      created: 1,
      updated: 0,
      unchanged: 0,
      errors: [],
    });

    const sample = await prisma.rndAromaSample.findFirst({
      where: { siteId, legacyId: legacyIds.ok },
    });
    expect(sample).toBeTruthy();
    expect(sample?.importLogId).toBe(body.importLogId);

    const importLog = await prisma.importLog.findUnique({
      where: { id: body.importLogId },
    });
    expect(importLog?.status).toBe(ImportStatus.VALIDE);
  });

  it('rejette (400) une confirmation dont une ligne a été altérée après la prévisualisation ; aucune écriture, ImportLog non VALIDE', async () => {
    const row: AromaSampleFixtureRow = {
      legacyId: legacyIds.altered,
      supplierNameRaw: 'Fournisseur E2E',
      productName: 'Produit E2E',
      category: 'Vanille',
    };
    const body = await preview(
      buildAromathequeXlsxBuffer([row]),
      fileNames.altered,
    );
    const previewRow = body.rows![0];

    await request(app.getHttpServer())
      .post('/rnd/aroma-samples/import/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({
        importLogId: body.importLogId,
        rows: [{ ...toConfirmRow(previewRow), productName: 'Produit altéré' }],
      })
      .expect(400);

    const count = await prisma.rndAromaSample.count({
      where: { siteId, legacyId: legacyIds.altered },
    });
    expect(count).toBe(0);

    const importLog = await prisma.importLog.findUnique({
      where: { id: body.importLogId },
    });
    expect(importLog?.status).toBe(ImportStatus.PREVISUALISE);
  });

  it('refuse une seconde confirmation du même ImportLog déjà validé', async () => {
    const row: AromaSampleFixtureRow = {
      legacyId: legacyIds.double,
      supplierNameRaw: 'Fournisseur E2E',
      productName: 'Produit E2E',
      category: 'Vanille',
    };
    const body = await preview(
      buildAromathequeXlsxBuffer([row]),
      fileNames.double,
    );
    const previewRow = body.rows![0];
    const confirmDto = {
      importLogId: body.importLogId,
      rows: [toConfirmRow(previewRow)],
    };

    await request(app.getHttpServer())
      .post('/rnd/aroma-samples/import/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send(confirmDto)
      .expect(200);

    await request(app.getHttpServer())
      .post('/rnd/aroma-samples/import/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send(confirmDto)
      .expect(400);

    const count = await prisma.rndAromaSample.count({
      where: { siteId, legacyId: legacyIds.double },
    });
    expect(count).toBe(1);
  });

  it('un réimport identique après confirmation est idempotent : classification "unchanged", aucune duplication', async () => {
    const row: AromaSampleFixtureRow = {
      legacyId: legacyIds.reimport,
      supplierNameRaw: 'Fournisseur E2E',
      productName: 'Produit E2E',
      category: 'Vanille',
      rating: 3,
      stockGrams: 100,
      pricePerKgEur: 50,
      addedAt: '2026-07-01',
      comment: 'Premier import',
    };
    const buffer = buildAromathequeXlsxBuffer([row]);

    const firstPreview = await preview(buffer, fileNames.reimport);
    const firstRow = firstPreview.rows![0];
    expect(firstRow.status).toBe('create');
    await request(app.getHttpServer())
      .post('/rnd/aroma-samples/import/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({
        importLogId: firstPreview.importLogId,
        rows: [toConfirmRow(firstRow)],
      })
      .expect(200);

    const secondPreview = await preview(buffer, fileNames.reimport);
    const secondRow = secondPreview.rows![0];
    expect(secondRow.status).toBe('unchanged');
    expect(secondPreview.toCreate).toBe(0);
    expect(secondPreview.unchanged).toBe(1);

    const secondConfirm = await request(app.getHttpServer())
      .post('/rnd/aroma-samples/import/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({
        importLogId: secondPreview.importLogId,
        rows: [toConfirmRow(secondRow)],
      })
      .expect(200);

    const secondConfirmBody =
      secondConfirm.body as AromaSamplesConfirmResponseBody;
    expect(secondConfirmBody).toMatchObject({
      created: 0,
      updated: 0,
      unchanged: 1,
      errors: [],
    });

    const count = await prisma.rndAromaSample.count({
      where: { siteId, legacyId: legacyIds.reimport },
    });
    expect(count).toBe(1);
  });
});
