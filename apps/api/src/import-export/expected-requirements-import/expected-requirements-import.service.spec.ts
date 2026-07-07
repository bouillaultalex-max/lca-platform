import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ExpectedRequirementsImportService } from './expected-requirements-import.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ImportParserService } from '../import-parser/import-parser.service';
import { ImportLogsService } from '../import-logs/import-logs.service';
import { ColumnMappingService } from '../../common/column-mapping/column-mapping.service';
import {
  Article,
  ArticleType,
  ImportStatus,
  Prisma,
} from '../../../generated/prisma/client';
import { ConfirmExpectedRequirementsImportDto } from './dto/confirm-expected-requirements-import.dto';
import { ColumnMappingSuggestion } from '../../common/column-mapping/column-mapping.types';

describe('ExpectedRequirementsImportService', () => {
  let service: ExpectedRequirementsImportService;

  let prisma: {
    article: { findMany: jest.Mock };
    importLog: { findFirst: jest.Mock };
    $transaction: jest.Mock<Promise<unknown>, [(tx: unknown) => unknown]>;
  };
  let tx: {
    expectedRequirement: {
      createMany: jest.Mock<Promise<unknown>, [Record<string, unknown>]>;
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

  const article = (overrides: Partial<Article> = {}): Article => ({
    id: 'article-1',
    siteId,
    type: ArticleType.PRODUIT_FINI,
    openSiReference: 'PF-LAVANDE-100ML',
    name: 'Parfum lavande 100ml',
    unitOfMeasure: 'unité',
    currentUnitCost: new Prisma.Decimal(3.2),
    unitsPerCarton: 100,
    densityKgPerL: null,
    active: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  });

  const completeSuggestion: ColumnMappingSuggestion = {
    fields: [
      {
        fieldKey: 'articleReference',
        label: 'Référence article',
        required: true,
        columnName: 'Référence',
        confidence: 100,
        reason: null,
      },
      {
        fieldKey: 'importedRequirement',
        label: 'Besoin attendu',
        required: true,
        columnName: 'Besoin',
        confidence: 100,
        reason: null,
      },
      {
        fieldKey: 'reservedQuantity',
        label: 'Quantité réservée',
        required: false,
        columnName: 'Réservé',
        confidence: 100,
        reason: null,
      },
      {
        fieldKey: 'importedAt',
        label: "Date de l'import",
        required: false,
        columnName: 'Date',
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
      originalname: 'besoins.xlsx',
    }) as Express.Multer.File;

  const validRawRow = {
    articleReference: 'PF-LAVANDE-100ML',
    importedRequirement: 500,
    reservedQuantity: 120,
    importedAt: '2026-07-06',
  };

  beforeEach(async () => {
    tx = {
      expectedRequirement: {
        createMany: jest.fn<Promise<unknown>, [Record<string, unknown>]>(),
      },
      importLog: {
        update: jest.fn<Promise<unknown>, [Record<string, unknown>]>(),
      },
    };
    prisma = {
      article: { findMany: jest.fn() },
      importLog: { findFirst: jest.fn() },
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
        ExpectedRequirementsImportService,
        { provide: PrismaService, useValue: prisma },
        { provide: ImportParserService, useValue: importParserService },
        { provide: ImportLogsService, useValue: importLogsService },
        { provide: ColumnMappingService, useValue: columnMappingService },
      ],
    }).compile();

    service = module.get(ExpectedRequirementsImportService);
  });

  describe('preview', () => {
    it('renvoie uniquement le mapping quand un champ obligatoire est manquant', async () => {
      importParserService.parse.mockReturnValue([{ line: 2, data: {} }]);
      columnMappingService.suggest.mockResolvedValue({
        ...completeSuggestion,
        missingRequiredFields: ['importedRequirement'],
      });

      const result = await service.preview(siteId, userId, file());

      expect(result.mappingComplete).toBe(false);
      expect(result.toImport).toBeUndefined();
      expect(columnMappingService.applyToRows).not.toHaveBeenCalled();
      expect(prisma.article.findMany).not.toHaveBeenCalled();
    });

    it('propose un besoin pour une référence existante et active', async () => {
      importParserService.parse.mockReturnValue([{ line: 2, data: {} }]);
      columnMappingService.applyToRows.mockReturnValue([
        { line: 2, values: validRawRow },
      ]);
      prisma.article.findMany.mockResolvedValue([article()]);

      const result = await service.preview(siteId, userId, file());

      expect(result.toImport).toEqual([
        {
          line: 2,
          articleReference: 'PF-LAVANDE-100ML',
          importedRequirement: 500,
          reservedQuantity: 120,
          importedAt: '2026-07-06',
        },
      ]);
      expect(result.errors).toEqual([]);
    });

    it('accepte une ligne sans reservedQuantity ni importedAt (les deux optionnels)', async () => {
      importParserService.parse.mockReturnValue([{ line: 2, data: {} }]);
      columnMappingService.applyToRows.mockReturnValue([
        {
          line: 2,
          values: {
            articleReference: 'PF-LAVANDE-100ML',
            importedRequirement: 500,
            reservedQuantity: null,
            importedAt: null,
          },
        },
      ]);
      prisma.article.findMany.mockResolvedValue([article()]);

      const result = await service.preview(siteId, userId, file());

      expect(result.errors).toEqual([]);
      expect(result.toImport?.[0]).toMatchObject({
        reservedQuantity: null,
        importedAt: null,
      });
    });

    it('signale une erreur pour une référence article introuvable', async () => {
      importParserService.parse.mockReturnValue([{ line: 2, data: {} }]);
      columnMappingService.applyToRows.mockReturnValue([
        { line: 2, values: { ...validRawRow, articleReference: 'INCONNU' } },
      ]);
      prisma.article.findMany.mockResolvedValue([]);

      const result = await service.preview(siteId, userId, file());

      expect(result.toImport).toEqual([]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors?.[0].message).toContain('introuvable');
    });

    it('signale une erreur bloquante pour un article désactivé', async () => {
      importParserService.parse.mockReturnValue([{ line: 2, data: {} }]);
      columnMappingService.applyToRows.mockReturnValue([
        { line: 2, values: validRawRow },
      ]);
      prisma.article.findMany.mockResolvedValue([article({ active: false })]);

      const result = await service.preview(siteId, userId, file());

      expect(result.toImport).toEqual([]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors?.[0].message).toContain('désactivé');
    });

    it('signale une erreur pour un besoin attendu invalide', async () => {
      importParserService.parse.mockReturnValue([{ line: 2, data: {} }]);
      columnMappingService.applyToRows.mockReturnValue([
        { line: 2, values: { ...validRawRow, importedRequirement: -5 } },
      ]);
      prisma.article.findMany.mockResolvedValue([article()]);

      const result = await service.preview(siteId, userId, file());

      expect(result.errors).toHaveLength(1);
      expect(result.errors?.[0].message).toContain('Besoin attendu invalide');
    });

    it('signale une erreur pour une quantité réservée invalide', async () => {
      importParserService.parse.mockReturnValue([{ line: 2, data: {} }]);
      columnMappingService.applyToRows.mockReturnValue([
        { line: 2, values: { ...validRawRow, reservedQuantity: 'abc' } },
      ]);
      prisma.article.findMany.mockResolvedValue([article()]);

      const result = await service.preview(siteId, userId, file());

      expect(result.errors).toHaveLength(1);
      expect(result.errors?.[0].message).toContain(
        'Quantité réservée invalide',
      );
    });

    it('signale une erreur pour une date invalide', async () => {
      importParserService.parse.mockReturnValue([{ line: 2, data: {} }]);
      columnMappingService.applyToRows.mockReturnValue([
        { line: 2, values: { ...validRawRow, importedAt: '31/02/2026' } },
      ]);
      prisma.article.findMany.mockResolvedValue([article()]);

      const result = await service.preview(siteId, userId, file());

      expect(result.errors).toHaveLength(1);
      expect(result.errors?.[0].message).toContain('Date invalide');
    });

    it('accepte la même référence plusieurs fois dans un même fichier, sans avertissement ni erreur', async () => {
      importParserService.parse.mockReturnValue([
        { line: 2, data: {} },
        { line: 3, data: {} },
      ]);
      columnMappingService.applyToRows.mockReturnValue([
        { line: 2, values: validRawRow },
        { line: 3, values: { ...validRawRow, importedRequirement: 800 } },
      ]);
      prisma.article.findMany.mockResolvedValue([article()]);

      const result = await service.preview(siteId, userId, file());

      expect(result.toImport).toHaveLength(2);
      expect(result.errors).toEqual([]);
    });
  });

  describe('confirm', () => {
    const baseDto: ConfirmExpectedRequirementsImportDto = {
      importLogId: 'import-log-1',
      rows: [
        {
          line: 2,
          articleReference: 'PF-LAVANDE-100ML',
          importedRequirement: 500,
          reservedQuantity: 120,
          importedAt: '2026-07-06',
        },
      ],
    };

    it("lève NotFoundException si l'import est introuvable pour ce site", async () => {
      prisma.importLog.findFirst.mockResolvedValue(null);

      await expect(service.confirm(siteId, userId, baseDto)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("rejette la confirmation d'un import déjà validé", async () => {
      prisma.importLog.findFirst.mockResolvedValue({
        id: 'import-log-1',
        status: ImportStatus.VALIDE,
      });

      await expect(service.confirm(siteId, userId, baseDto)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('crée un nouvel enregistrement par ligne valide et met à jour le journal', async () => {
      prisma.importLog.findFirst.mockResolvedValue({
        id: 'import-log-1',
        status: ImportStatus.PREVISUALISE,
      });
      prisma.article.findMany.mockResolvedValue([article()]);

      const result = await service.confirm(siteId, userId, baseDto);

      expect(tx.expectedRequirement.createMany).toHaveBeenCalledWith({
        data: [
          {
            siteId,
            articleId: 'article-1',
            importedRequirement: 500,
            reservedQuantity: 120,
            importedAt: new Date('2026-07-06'),
          },
        ],
      });
      expect(tx.importLog.update).toHaveBeenCalledWith({
        where: { id: 'import-log-1' },
        data: {
          status: ImportStatus.VALIDE,
          processedLines: 1,
          errorCount: 0,
          errorDetails: undefined,
        },
      });
      expect(result).toEqual({
        importLogId: 'import-log-1',
        imported: 1,
        errors: [],
      });
    });

    it("utilise l'instant de la confirmation quand importedAt est absent", async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-07-06T10:00:00.000Z'));
      prisma.importLog.findFirst.mockResolvedValue({
        id: 'import-log-1',
        status: ImportStatus.PREVISUALISE,
      });
      prisma.article.findMany.mockResolvedValue([article()]);

      await service.confirm(siteId, userId, {
        importLogId: 'import-log-1',
        rows: [
          {
            line: 2,
            articleReference: 'PF-LAVANDE-100ML',
            importedRequirement: 500,
          },
        ],
      });

      const call = tx.expectedRequirement.createMany.mock.calls[0][0] as {
        data: { importedAt: Date }[];
      };
      expect(call.data[0].importedAt).toEqual(
        new Date('2026-07-06T10:00:00.000Z'),
      );

      jest.useRealTimers();
    });

    it('revalide entièrement côté serveur : exclut une ligne dont l’article a été désactivé entre-temps', async () => {
      prisma.importLog.findFirst.mockResolvedValue({
        id: 'import-log-1',
        status: ImportStatus.PREVISUALISE,
      });
      prisma.article.findMany.mockResolvedValue([article({ active: false })]);

      const result = await service.confirm(siteId, userId, baseDto);

      expect(tx.expectedRequirement.createMany).not.toHaveBeenCalled();
      expect(result.imported).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('désactivé');
    });
  });
});
