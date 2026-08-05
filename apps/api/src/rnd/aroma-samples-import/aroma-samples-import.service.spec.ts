import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AromaSamplesImportService } from './aroma-samples-import.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ImportParserService } from '../../import-export/import-parser/import-parser.service';
import { ImportLogsService } from '../../import-export/import-logs/import-logs.service';
import { ColumnMappingService } from '../../common/column-mapping/column-mapping.service';
import { AROMA_SAMPLE_MAPPING_CONFIG } from '../mapping-configs/aroma-sample.mapping-config';
import {
  ImportStatus,
  Prisma,
  RndAromaSample,
} from '../../../generated/prisma/client';
import { ConfirmAromaSamplesImportDto } from './dto/confirm-aroma-samples-import.dto';
import { ColumnMappingSuggestion } from '../../common/column-mapping/column-mapping.types';

/**
 * Vérifie `AromaSamplesImportService` (RD-01C-3) sans jamais lire le fichier Excel
 * réel ni écrire de donnée réelle en base : `ImportParserService`, `ImportLogsService`
 * et `ColumnMappingService` sont intégralement mockés, `PrismaService` l'est aussi
 * (y compris le client transactionnel `tx`), sur le même patron que
 * `articles-import.service.spec.ts` / `stocks-import.service.spec.ts`.
 */
describe('AromaSamplesImportService', () => {
  let service: AromaSamplesImportService;

  let prisma: {
    rndAromaSample: {
      findMany: jest.Mock<Promise<unknown[]>, [unknown]>;
    };
    importLog: {
      findFirst: jest.Mock<Promise<unknown>, [unknown]>;
      update: jest.Mock<Promise<unknown>, [Record<string, unknown>]>;
    };
    $transaction: jest.Mock<Promise<unknown>, [(tx: unknown) => unknown]>;
  };
  let tx: {
    rndAromaSample: {
      create: jest.Mock<Promise<unknown>, [Record<string, unknown>]>;
      update: jest.Mock<Promise<unknown>, [Record<string, unknown>]>;
    };
    importLog: {
      update: jest.Mock<Promise<unknown>, [Record<string, unknown>]>;
    };
  };
  let importParserService: { parse: jest.Mock };
  let importLogsService: { createPreview: jest.Mock };
  let columnMappingService: {
    suggest: jest.Mock;
    resolve: jest.Mock;
    applyToRows: jest.Mock;
    learnFromCorrections: jest.Mock;
  };

  const siteId = 'site-1';
  const userId = 'user-1';

  const sample = (overrides: Partial<RndAromaSample> = {}): RndAromaSample => ({
    id: 'sample-1',
    siteId,
    legacyId: 'EF-0378-001',
    supplierNameRaw: 'Fournisseur X',
    productName: 'Vanille Bourbon',
    supplierReference: 'REF-001',
    category: 'Vanille',
    rating: new Prisma.Decimal(4),
    stockGrams: new Prisma.Decimal(250),
    pricePerKgEur: new Prisma.Decimal(89.5),
    addedAt: new Date('2026-07-06T00:00:00.000Z'),
    comment: 'Échantillon test',
    linkedArticleId: null,
    active: true,
    importLogId: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  });

  const completeSuggestion: ColumnMappingSuggestion = {
    fields: [
      {
        fieldKey: 'legacyId',
        label: 'Identifiant historique',
        required: true,
        columnName: 'EF-0378',
        confidence: 100,
        reason: null,
      },
      {
        fieldKey: 'supplierNameRaw',
        label: 'Fournisseur',
        required: true,
        columnName: 'Fournisseur',
        confidence: 100,
        reason: null,
      },
      {
        fieldKey: 'productName',
        label: 'Produit / Arôme',
        required: true,
        columnName: 'Produit / Arôme',
        confidence: 100,
        reason: null,
      },
      {
        fieldKey: 'supplierReference',
        label: 'Référence fournisseur',
        required: false,
        columnName: 'Référence',
        confidence: 100,
        reason: null,
      },
      {
        fieldKey: 'category',
        label: 'Catégorie',
        required: false,
        columnName: 'Catégorie',
        confidence: 100,
        reason: null,
      },
      {
        fieldKey: 'rating',
        label: 'Note',
        required: false,
        columnName: 'Note ★',
        confidence: 100,
        reason: null,
      },
      {
        fieldKey: 'stockGrams',
        label: 'Stock (g)',
        required: false,
        columnName: 'Stock (g)',
        confidence: 100,
        reason: null,
      },
      {
        fieldKey: 'pricePerKgEur',
        label: 'Prix par kg (€)',
        required: false,
        columnName: 'Prix/kg (€)',
        confidence: 100,
        reason: null,
      },
      {
        fieldKey: 'addedAt',
        label: "Date d'ajout",
        required: false,
        columnName: 'Date ajout',
        confidence: 100,
        reason: null,
      },
      {
        fieldKey: 'comment',
        label: 'Commentaire',
        required: false,
        columnName: 'Commentaire',
        confidence: 100,
        reason: null,
      },
    ],
    ignoredColumns: [],
    missingRequiredFields: [],
    hints: [],
  };

  const file = (): Express.Multer.File =>
    ({
      buffer: Buffer.from('fake'),
      originalname: 'aromatheque.xlsx',
    }) as Express.Multer.File;

  /** Ligne brute valide sur les 10 champs, réutilisée comme base par la plupart des tests. */
  const validRawRow: Record<string, unknown> = {
    legacyId: 'EF-0378-001',
    supplierNameRaw: 'Fournisseur X',
    productName: 'Vanille Bourbon',
    supplierReference: 'REF-001',
    category: 'Vanille',
    rating: 4,
    stockGrams: 250,
    pricePerKgEur: 89.5,
    addedAt: '2026-07-06',
    comment: 'Échantillon test',
  };

  beforeEach(async () => {
    tx = {
      rndAromaSample: {
        create: jest.fn<Promise<unknown>, [Record<string, unknown>]>(),
        update: jest.fn<Promise<unknown>, [Record<string, unknown>]>(),
      },
      importLog: {
        update: jest.fn<Promise<unknown>, [Record<string, unknown>]>(),
      },
    };
    prisma = {
      rndAromaSample: {
        // Valeur par défaut (aucun échantillon existant) ; surchargée via
        // `mockResolvedValueOnce` quand un test a besoin d'un état précis. `classify()`
        // appelle `findMany` une ou deux fois (voir aroma-samples-import.service.ts) :
        // le repli par défaut couvre les appels non explicitement surchargés.
        findMany: jest
          .fn<Promise<unknown[]>, [unknown]>()
          .mockResolvedValue([]),
      },
      importLog: {
        findFirst: jest.fn<Promise<unknown>, [unknown]>(),
        update: jest.fn<Promise<unknown>, [Record<string, unknown>]>(),
      },
      $transaction: jest.fn<Promise<unknown>, [(tx: unknown) => unknown]>(
        (callback) => Promise.resolve(callback(tx)),
      ),
    };
    importParserService = { parse: jest.fn() };
    importLogsService = {
      createPreview: jest.fn().mockResolvedValue({ id: 'import-log-1' }),
    };
    columnMappingService = {
      suggest: jest.fn().mockResolvedValue(completeSuggestion),
      resolve: jest.fn(),
      applyToRows: jest.fn(),
      learnFromCorrections: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AromaSamplesImportService,
        { provide: PrismaService, useValue: prisma },
        { provide: ImportParserService, useValue: importParserService },
        { provide: ImportLogsService, useValue: importLogsService },
        { provide: ColumnMappingService, useValue: columnMappingService },
      ],
    }).compile();

    service = module.get(AromaSamplesImportService);
  });

  /** Prépare `parse()` + `applyToRows()` pour renvoyer directement les lignes mappées données. */
  function mockParseAndMap(
    rows: { line: number; values: Record<string, unknown> }[],
  ): void {
    importParserService.parse.mockReturnValueOnce(
      rows.map((row) => ({ line: row.line, data: {} })),
    );
    columnMappingService.applyToRows.mockReturnValueOnce(rows);
  }

  /**
   * Exécute une prévisualisation portant une seule ligne brute donnée et renvoie
   * l'empreinte réellement calculée et écrite sur `ImportLog.previewHash` — pour
   * construire, dans les tests de confirmation, un `ImportLog` dont l'empreinte
   * correspond exactement aux lignes qui seront soumises à `confirm()` (l'empreinte
   * ne dépend que du contenu des lignes, jamais de l'état de la base — voir
   * `computePreviewHash` dans le service).
   */
  async function computePreviewHashFor(
    rawRow: Record<string, unknown>,
  ): Promise<string> {
    prisma.importLog.update.mockClear();
    mockParseAndMap([{ line: 2, values: rawRow }]);
    await service.preview(siteId, userId, file());
    const call = prisma.importLog.update.mock.calls[0][0] as {
      data: { previewHash: string };
    };
    return call.data.previewHash;
  }

  describe('sélection de la source et du mapping', () => {
    it('sélectionne explicitement la feuille "🗂 Aromatèque Complète" du fichier source', async () => {
      mockParseAndMap([{ line: 2, values: validRawRow }]);

      await service.preview(siteId, userId, file());

      expect(importParserService.parse).toHaveBeenCalledWith(
        expect.any(Buffer),
        'aromatheque.xlsx',
        '🗂 Aromatèque Complète',
      );
    });

    it('utilise directement AROMA_SAMPLE_MAPPING_CONFIG avec une source et un type d’entité propres à l’Aromathèque', async () => {
      mockParseAndMap([{ line: 2, values: validRawRow }]);

      await service.preview(siteId, userId, file());

      expect(columnMappingService.suggest).toHaveBeenCalledWith(
        siteId,
        'AROMATHEQUE_EXCEL',
        'AROMA_SAMPLE',
        expect.any(Array),
        AROMA_SAMPLE_MAPPING_CONFIG,
      );
    });

    it('ne calcule ni n’enregistre aucune empreinte, ni ne classe de ligne, quand le mapping reste incomplet', async () => {
      importParserService.parse.mockReturnValueOnce([{ line: 2, data: {} }]);
      columnMappingService.suggest.mockResolvedValueOnce({
        ...completeSuggestion,
        missingRequiredFields: ['productName'],
      });

      const result = await service.preview(siteId, userId, file());

      expect(result.mappingComplete).toBe(false);
      expect(result.rows).toBeUndefined();
      expect(columnMappingService.applyToRows).not.toHaveBeenCalled();
      expect(prisma.rndAromaSample.findMany).not.toHaveBeenCalled();
      expect(prisma.importLog.update).not.toHaveBeenCalled();
    });
  });

  describe('parsing des lignes', () => {
    it('interprète une ligne complète', async () => {
      mockParseAndMap([{ line: 2, values: validRawRow }]);

      const result = await service.preview(siteId, userId, file());

      expect(result.errors).toEqual([]);
      expect(result.rows).toEqual([
        {
          line: 2,
          legacyId: 'EF-0378-001',
          supplierNameRaw: 'Fournisseur X',
          productName: 'Vanille Bourbon',
          supplierReference: 'REF-001',
          category: 'Vanille',
          rating: 4,
          stockGrams: 250,
          pricePerKgEur: 89.5,
          addedAt: '2026-07-06',
          comment: 'Échantillon test',
          status: 'create',
          sampleId: null,
          changes: [],
        },
      ]);
    });

    it('accepte une référence fournisseur absente (devient null)', async () => {
      mockParseAndMap([
        { line: 2, values: { ...validRawRow, supplierReference: null } },
      ]);

      const result = await service.preview(siteId, userId, file());

      expect(result.errors).toEqual([]);
      expect(result.rows?.[0].supplierReference).toBeNull();
    });

    it('remplace une catégorie vide par "Autre", uniquement sur une ligne portant les 3 champs obligatoires', async () => {
      mockParseAndMap([
        { line: 2, values: { ...validRawRow, category: null } },
      ]);

      const result = await service.preview(siteId, userId, file());

      expect(result.errors).toEqual([]);
      expect(result.rows?.[0].category).toBe('Autre');
    });

    it('signale une erreur de ligne pour chaque champ obligatoire manquant (identifiant historique, fournisseur, produit)', async () => {
      mockParseAndMap([
        { line: 2, values: { ...validRawRow, legacyId: null } },
        {
          line: 3,
          values: { ...validRawRow, legacyId: 'EF-2', supplierNameRaw: null },
        },
        {
          line: 4,
          values: { ...validRawRow, legacyId: 'EF-3', productName: null },
        },
      ]);

      const result = await service.preview(siteId, userId, file());

      expect(result.rows).toEqual([]);
      expect(result.errors).toHaveLength(3);
      expect(result.errors?.[0].message).toContain(
        'Identifiant historique manquant',
      );
      expect(result.errors?.[1].message).toContain('Fournisseur manquant');
      expect(result.errors?.[2].message).toContain('Produit / arôme manquant');
    });

    it('accepte les décimaux au format français (virgule) pour la note, le stock et le prix', async () => {
      mockParseAndMap([
        {
          line: 2,
          values: {
            ...validRawRow,
            rating: '4,5',
            stockGrams: '250,75',
            pricePerKgEur: '89,90',
          },
        },
      ]);

      const result = await service.preview(siteId, userId, file());

      expect(result.errors).toEqual([]);
      expect(result.rows?.[0]).toMatchObject({
        rating: 4.5,
        stockGrams: 250.75,
        pricePerKgEur: 89.9,
      });
    });

    it('accepte un numéro de série Excel pour la date d’ajout', async () => {
      mockParseAndMap([
        { line: 2, values: { ...validRawRow, addedAt: 46209 } },
      ]);

      const result = await service.preview(siteId, userId, file());

      expect(result.errors).toEqual([]);
      expect(result.rows?.[0].addedAt).toBe('2026-07-06');
    });

    it('transforme les cellules facultatives vides en null (référence, note, stock, prix, date, commentaire)', async () => {
      mockParseAndMap([
        {
          line: 2,
          values: {
            ...validRawRow,
            supplierReference: null,
            rating: null,
            stockGrams: null,
            pricePerKgEur: null,
            addedAt: null,
            comment: null,
          },
        },
      ]);

      const result = await service.preview(siteId, userId, file());

      expect(result.errors).toEqual([]);
      expect(result.rows?.[0]).toMatchObject({
        supplierReference: null,
        rating: null,
        stockGrams: null,
        pricePerKgEur: null,
        addedAt: null,
        comment: null,
      });
    });
  });

  describe('classification', () => {
    it('classe une ligne en création quand aucun échantillon du site ne porte ce legacyId', async () => {
      mockParseAndMap([{ line: 2, values: validRawRow }]);

      const result = await service.preview(siteId, userId, file());

      expect(result.toCreate).toBe(1);
      expect(result.toUpdate).toBe(0);
      expect(result.unchanged).toBe(0);
      expect(result.rows?.[0]).toMatchObject({
        status: 'create',
        sampleId: null,
      });
    });

    it('classe en mise à jour une ligne dont au moins un champ importable diffère, avec le diff', async () => {
      mockParseAndMap([
        { line: 2, values: { ...validRawRow, productName: 'Nouveau nom' } },
      ]);
      const existing = sample();
      prisma.rndAromaSample.findMany.mockResolvedValueOnce([existing]);

      const result = await service.preview(siteId, userId, file());

      expect(result.toUpdate).toBe(1);
      expect(result.rows?.[0]).toMatchObject({
        status: 'update',
        sampleId: existing.id,
        changes: [
          {
            field: 'productName',
            label: 'Produit / Arôme',
            before: 'Vanille Bourbon',
            after: 'Nouveau nom',
          },
        ],
      });
    });

    it('classe en inchangée une ligne strictement identique sur les 9 champs importables', async () => {
      mockParseAndMap([{ line: 2, values: validRawRow }]);
      const existing = sample();
      prisma.rndAromaSample.findMany.mockResolvedValueOnce([existing]);

      const result = await service.preview(siteId, userId, file());

      expect(result.unchanged).toBe(1);
      expect(result.rows?.[0]).toMatchObject({
        status: 'unchanged',
        sampleId: existing.id,
        changes: [],
      });
    });

    it('signale une erreur bloquante pour un identifiant historique répété dans le fichier, sans écarter la première occurrence', async () => {
      mockParseAndMap([
        { line: 2, values: validRawRow },
        { line: 3, values: { ...validRawRow, productName: 'Autre produit' } },
      ]);

      const result = await service.preview(siteId, userId, file());

      expect(result.rows).toHaveLength(1);
      expect(result.rows?.[0].line).toBe(2);
      expect(result.errors).toHaveLength(1);
      expect(result.errors?.[0]).toMatchObject({
        line: 3,
        legacyId: 'EF-0378-001',
      });
      expect(result.errors?.[0].message).toContain('doublon');
    });
  });

  describe('avertissements de doublons potentiels', () => {
    it('signale un avertissement (non bloquant) pour une référence fournisseur dupliquée intra-fichier', async () => {
      mockParseAndMap([
        { line: 2, values: { ...validRawRow, legacyId: 'EF-1' } },
        {
          line: 3,
          values: {
            ...validRawRow,
            legacyId: 'EF-2',
            supplierReference: '  ref-001 ',
            // Fournisseur + produit différents : isole l'avertissement de référence,
            // sans déclencher aussi celui de fournisseur+produit dupliqués.
            supplierNameRaw: 'Autre fournisseur',
            productName: 'Autre arôme',
          },
        },
      ]);

      const result = await service.preview(siteId, userId, file());

      expect(result.errors).toEqual([]);
      expect(result.rows).toHaveLength(2);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings?.[0]).toMatchObject({
        line: 3,
        legacyId: 'EF-2',
        kind: 'REFERENCE_FOURNISSEUR_DUPLIQUEE',
      });
    });

    it('signale un avertissement (non bloquant) pour un fournisseur + produit dupliqués intra-fichier', async () => {
      mockParseAndMap([
        {
          line: 2,
          values: {
            ...validRawRow,
            legacyId: 'EF-1',
            supplierReference: 'REF-A',
          },
        },
        {
          line: 3,
          values: {
            ...validRawRow,
            legacyId: 'EF-2',
            supplierReference: 'REF-B',
            supplierNameRaw: 'FOURNISSEUR X',
            productName: 'vanille   bourbon',
          },
        },
      ]);

      const result = await service.preview(siteId, userId, file());

      expect(result.errors).toEqual([]);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings?.[0]).toMatchObject({
        line: 3,
        legacyId: 'EF-2',
        kind: 'FOURNISSEUR_PRODUIT_DUPLIQUE',
      });
    });

    it('signale un avertissement (non bloquant) pour un doublon potentiel déjà présent en base', async () => {
      mockParseAndMap([
        { line: 2, values: { ...validRawRow, legacyId: 'EF-NOUVEAU' } },
      ]);
      const existingOther = sample({
        id: 'sample-autre',
        legacyId: 'EF-AUTRE',
      });
      prisma.rndAromaSample.findMany
        .mockResolvedValueOnce([]) // par legacyId : "EF-NOUVEAU" introuvable
        .mockResolvedValueOnce([existingOther]); // base complète du site

      const result = await service.preview(siteId, userId, file());

      expect(result.errors).toEqual([]);
      expect(
        result.warnings?.some(
          (warning) => warning.kind === 'REFERENCE_FOURNISSEUR_DUPLIQUEE',
        ),
      ).toBe(true);
    });

    it('ne signale jamais un échantillon existant comme doublon de lui-même (même legacyId)', async () => {
      mockParseAndMap([{ line: 2, values: validRawRow }]);
      const existing = sample();
      prisma.rndAromaSample.findMany
        .mockResolvedValueOnce([existing])
        .mockResolvedValueOnce([existing]);

      const result = await service.preview(siteId, userId, file());

      expect(result.warnings).toEqual([]);
    });

    it('un avertissement de doublon potentiel reste non bloquant : la ligne est confirmable et correctement classée', async () => {
      mockParseAndMap([
        { line: 2, values: { ...validRawRow, legacyId: 'EF-NOUVEAU' } },
      ]);
      const existingOther = sample({
        id: 'sample-autre',
        legacyId: 'EF-AUTRE',
      });
      prisma.rndAromaSample.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([existingOther]);

      const result = await service.preview(siteId, userId, file());

      expect(result.warnings?.length).toBeGreaterThanOrEqual(1);
      expect(result.errors).toEqual([]);
      expect(result.toCreate).toBe(1);
      expect(result.rows?.[0].status).toBe('create');
    });
  });

  describe('empreinte previewHash', () => {
    it('produit la même empreinte quel que soit l’ordre des lignes dans le fichier', async () => {
      const rowA = { ...validRawRow, legacyId: 'EF-A' };
      const rowB = {
        ...validRawRow,
        legacyId: 'EF-B',
        supplierReference: 'REF-B',
      };

      mockParseAndMap([
        { line: 2, values: rowA },
        { line: 3, values: rowB },
      ]);
      await service.preview(siteId, userId, file());
      const hash1 = (
        prisma.importLog.update.mock.calls[0][0] as {
          data: { previewHash: string };
        }
      ).data.previewHash;

      mockParseAndMap([
        { line: 2, values: rowB },
        { line: 3, values: rowA },
      ]);
      await service.preview(siteId, userId, file());
      const hash2 = (
        prisma.importLog.update.mock.calls[1][0] as {
          data: { previewHash: string };
        }
      ).data.previewHash;

      expect(hash1).toBe(hash2);
    });

    it('produit une empreinte différente dès qu’un seul champ change', async () => {
      mockParseAndMap([{ line: 2, values: validRawRow }]);
      await service.preview(siteId, userId, file());
      const hash1 = (
        prisma.importLog.update.mock.calls[0][0] as {
          data: { previewHash: string };
        }
      ).data.previewHash;

      mockParseAndMap([
        { line: 2, values: { ...validRawRow, comment: 'Commentaire modifié' } },
      ]);
      await service.preview(siteId, userId, file());
      const hash2 = (
        prisma.importLog.update.mock.calls[1][0] as {
          data: { previewHash: string };
        }
      ).data.previewHash;

      expect(hash1).not.toBe(hash2);
    });

    it("n'est affectée ni par les erreurs de ligne, ni par les avertissements de doublon, ni par la classification", async () => {
      // Référence : une seule ligne valide, aucun échantillon existant.
      mockParseAndMap([{ line: 2, values: validRawRow }]);
      await service.preview(siteId, userId, file());
      const referenceHash = (
        prisma.importLog.update.mock.calls[0][0] as {
          data: { previewHash: string };
        }
      ).data.previewHash;

      // Même ligne valide + une ligne invalide (exclue) + un doublon potentiel en base
      // (avertissement) — le contenu confirmable reste strictement identique.
      mockParseAndMap([
        { line: 2, values: validRawRow },
        { line: 3, values: { ...validRawRow, legacyId: '' } },
      ]);
      prisma.rndAromaSample.findMany
        .mockResolvedValueOnce([]) // par legacyId : "EF-0378-001" introuvable
        .mockResolvedValueOnce([
          sample({
            id: 'sample-autre',
            legacyId: 'EF-AUTRE',
            supplierReference: validRawRow.supplierReference as string,
          }),
        ]); // base complète : déclenche un avertissement
      const result = await service.preview(siteId, userId, file());
      const comparisonHash = (
        prisma.importLog.update.mock.calls[1][0] as {
          data: { previewHash: string };
        }
      ).data.previewHash;

      expect(result.errors).toHaveLength(1);
      expect(result.warnings?.length).toBeGreaterThanOrEqual(1);
      expect(comparisonHash).toBe(referenceHash);
    });

    it('enregistre une empreinte SHA-256 (hexadécimale, 64 caractères) sur ImportLog', async () => {
      mockParseAndMap([{ line: 2, values: validRawRow }]);

      await service.preview(siteId, userId, file());

      const call = prisma.importLog.update.mock.calls[0][0] as {
        where: { id: string };
        data: { previewHash: string };
      };
      expect(call.where).toEqual({ id: 'import-log-1' });
      expect(call.data.previewHash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('confirmation', () => {
    const confirmRow = {
      line: 2,
      legacyId: 'EF-0378-001',
      supplierNameRaw: 'Fournisseur X',
      productName: 'Vanille Bourbon',
      supplierReference: 'REF-001',
      category: 'Vanille',
      rating: 4,
      stockGrams: 250,
      pricePerKgEur: 89.5,
      addedAt: '2026-07-06',
      comment: 'Échantillon test',
    };

    it("lève NotFoundException si l'import est introuvable pour ce site/type", async () => {
      prisma.importLog.findFirst.mockResolvedValue(null);

      await expect(
        service.confirm(siteId, userId, {
          importLogId: 'import-log-1',
          rows: [confirmRow],
        }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("rejette la confirmation d'un import qui n'est plus en attente de confirmation (statut différent de PREVISUALISE)", async () => {
      prisma.importLog.findFirst.mockResolvedValue({
        id: 'import-log-1',
        status: ImportStatus.VALIDE,
        previewHash: 'peu importe',
      });

      await expect(
        service.confirm(siteId, userId, {
          importLogId: 'import-log-1',
          rows: [confirmRow],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejette la confirmation quand previewHash est absent', async () => {
      prisma.importLog.findFirst.mockResolvedValue({
        id: 'import-log-1',
        status: ImportStatus.PREVISUALISE,
        previewHash: null,
      });

      await expect(
        service.confirm(siteId, userId, {
          importLogId: 'import-log-1',
          rows: [confirmRow],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejette des lignes altérées par rapport à la prévisualisation, avant toute transaction', async () => {
      prisma.importLog.findFirst.mockResolvedValue({
        id: 'import-log-1',
        status: ImportStatus.PREVISUALISE,
        previewHash: 'empreinte-qui-ne-correspondra-jamais',
      });

      await expect(
        service.confirm(siteId, userId, {
          importLogId: 'import-log-1',
          rows: [confirmRow],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('revalide intégralement les lignes soumises : une ligne redevenue invalide est exclue et remontée en erreur', async () => {
      const previewHash = await computePreviewHashFor({
        ...confirmRow,
        legacyId: '',
      });
      prisma.importLog.findFirst.mockResolvedValue({
        id: 'import-log-1',
        status: ImportStatus.PREVISUALISE,
        previewHash,
      });

      const result = await service.confirm(siteId, userId, {
        importLogId: 'import-log-1',
        rows: [{ ...confirmRow, legacyId: '' }],
      });

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain(
        'Identifiant historique manquant',
      );
      expect(result.created).toBe(0);
      expect(result.updated).toBe(0);
      expect(result.unchanged).toBe(0);
    });

    it(
      'crée, met à jour et laisse inchangé chaque ligne selon sa classification, renseigne importLogId sur ' +
        "les lignes écrites, ne touche jamais active/linkedArticleId/siteId, n'écrit rien pour une ligne " +
        'inchangée ni pour un échantillon existant absent du fichier réimporté, et marque le journal VALIDE ' +
        'dans la même transaction',
      async () => {
        const createRow = {
          ...confirmRow,
          legacyId: 'EF-NEW',
          supplierNameRaw: 'Nouveau fournisseur',
          productName: 'Nouvel arôme',
        };
        const updateRow = {
          ...confirmRow,
          legacyId: 'EF-UPD',
          productName: 'Nom modifié',
        };
        const unchangedRow = { ...confirmRow, legacyId: 'EF-SAME' };

        const existingForUpdate = sample({
          id: 'sample-upd',
          legacyId: 'EF-UPD',
          productName: 'Ancien nom',
        });
        const existingUnchanged = sample({
          id: 'sample-same',
          legacyId: 'EF-SAME',
        });
        // Échantillon déjà en base, absent du fichier réimporté : ne doit jamais être touché.
        const untouchedExisting = sample({
          id: 'sample-absent',
          legacyId: 'EF-ABSENT',
        });

        mockParseAndMap([
          { line: 2, values: createRow },
          { line: 3, values: updateRow },
          { line: 4, values: unchangedRow },
        ]);
        const previewHash = await (async () => {
          prisma.importLog.update.mockClear();
          await service.preview(siteId, userId, file());
          const call = prisma.importLog.update.mock.calls[0][0] as {
            data: { previewHash: string };
          };
          return call.data.previewHash;
        })();

        prisma.importLog.findFirst.mockResolvedValue({
          id: 'import-log-1',
          status: ImportStatus.PREVISUALISE,
          previewHash,
        });
        prisma.rndAromaSample.findMany
          .mockResolvedValueOnce([existingForUpdate, existingUnchanged]) // par legacyId (EF-NEW introuvable)
          .mockResolvedValueOnce([
            existingForUpdate,
            existingUnchanged,
            untouchedExisting,
          ]); // base complète du site

        const dto: ConfirmAromaSamplesImportDto = {
          importLogId: 'import-log-1',
          rows: [
            { line: 2, ...createRow },
            { line: 3, ...updateRow },
            { line: 4, ...unchangedRow },
          ],
        };

        const result = await service.confirm(siteId, userId, dto);

        // Une seule création, une seule mise à jour : ni la ligne inchangée, ni
        // l'échantillon absent du fichier (EF-ABSENT) ne provoquent d'écriture.
        expect(tx.rndAromaSample.create).toHaveBeenCalledTimes(1);
        const createCall = tx.rndAromaSample.create.mock.calls[0][0] as {
          data: Record<string, unknown>;
        };
        expect(createCall.data).toMatchObject({
          siteId,
          legacyId: 'EF-NEW',
          importLogId: 'import-log-1',
        });
        expect(createCall.data).not.toHaveProperty('active');
        expect(createCall.data).not.toHaveProperty('linkedArticleId');

        expect(tx.rndAromaSample.update).toHaveBeenCalledTimes(1);
        const updateCall = tx.rndAromaSample.update.mock.calls[0][0] as {
          where: { id: string };
          data: Record<string, unknown>;
        };
        expect(updateCall.where).toEqual({ id: 'sample-upd' });
        expect(updateCall.data).toMatchObject({
          productName: 'Nom modifié',
          importLogId: 'import-log-1',
        });
        expect(updateCall.data).not.toHaveProperty('active');
        expect(updateCall.data).not.toHaveProperty('linkedArticleId');
        expect(updateCall.data).not.toHaveProperty('siteId');

        expect(tx.importLog.update).toHaveBeenCalledWith({
          where: { id: 'import-log-1' },
          data: {
            status: ImportStatus.VALIDE,
            processedLines: 3,
            errorCount: 0,
            errorDetails: undefined,
          },
        });

        expect(result).toEqual({
          importLogId: 'import-log-1',
          created: 1,
          updated: 1,
          unchanged: 1,
          errors: [],
        });
      },
    );

    it('ne marque jamais le journal VALIDE si une écriture échoue pendant la transaction (aucune écriture partielle)', async () => {
      const previewHash = await computePreviewHashFor(confirmRow);
      prisma.importLog.findFirst.mockResolvedValue({
        id: 'import-log-1',
        status: ImportStatus.PREVISUALISE,
        previewHash,
      });
      tx.rndAromaSample.create.mockRejectedValue(
        new Error('Échec disque simulé'),
      );

      await expect(
        service.confirm(siteId, userId, {
          importLogId: 'import-log-1',
          rows: [confirmRow],
        }),
      ).rejects.toThrow('Échec disque simulé');

      expect(tx.importLog.update).not.toHaveBeenCalled();
    });

    it('refuse une seconde confirmation du même import une fois celui-ci passé VALIDE', async () => {
      const previewHash = await computePreviewHashFor(confirmRow);
      prisma.importLog.findFirst.mockResolvedValueOnce({
        id: 'import-log-1',
        status: ImportStatus.PREVISUALISE,
        previewHash,
      });

      await service.confirm(siteId, userId, {
        importLogId: 'import-log-1',
        rows: [confirmRow],
      });

      // Deuxième appel : le journal est désormais VALIDE (comportement réel après
      // la première confirmation), une nouvelle tentative doit être refusée.
      prisma.importLog.findFirst.mockResolvedValueOnce({
        id: 'import-log-1',
        status: ImportStatus.VALIDE,
        previewHash,
      });

      await expect(
        service.confirm(siteId, userId, {
          importLogId: 'import-log-1',
          rows: [confirmRow],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
