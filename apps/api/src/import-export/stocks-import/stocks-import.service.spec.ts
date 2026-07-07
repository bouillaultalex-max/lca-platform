import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { StocksImportService } from './stocks-import.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ImportParserService } from '../import-parser/import-parser.service';
import { ImportLogsService } from '../import-logs/import-logs.service';
import { ColumnMappingService } from '../../common/column-mapping/column-mapping.service';
import { StockLotsService } from '../../stock/stock-lots/stock-lots.service';
import {
  Article,
  ArticleType,
  ImportStatus,
  Prisma,
} from '../../../generated/prisma/client';
import { ConfirmStocksImportDto } from './dto/confirm-stocks-import.dto';
import { ColumnMappingSuggestion } from '../../common/column-mapping/column-mapping.types';

describe('StocksImportService', () => {
  let service: StocksImportService;

  let prisma: {
    article: { findMany: jest.Mock };
    stockLot: { findMany: jest.Mock };
    importLog: { findFirst: jest.Mock };
    $transaction: jest.Mock<Promise<unknown>, [(tx: unknown) => unknown]>;
  };
  let tx: {
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
  let stockLotsService: { receive: jest.Mock };

  const siteId = 'site-1';
  const userId = 'user-1';

  const article = (overrides: Partial<Article> = {}): Article => ({
    id: 'article-1',
    siteId,
    type: ArticleType.MATIERE_PREMIERE,
    openSiReference: 'MP-LAVANDE',
    name: 'Parfum lavande',
    unitOfMeasure: 'L',
    currentUnitCost: new Prisma.Decimal(12.5),
    unitsPerCarton: null,
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
        fieldKey: 'supplierLotNumber',
        label: 'Lot fournisseur',
        required: true,
        columnName: 'Lot',
        confidence: 100,
        reason: null,
      },
      {
        fieldKey: 'receivedQuantity',
        label: 'Quantité reçue',
        required: true,
        columnName: 'Quantité',
        confidence: 100,
        reason: null,
      },
      {
        fieldKey: 'receivedAt',
        label: 'Date de réception',
        required: true,
        columnName: 'Date',
        confidence: 100,
        reason: null,
      },
      {
        fieldKey: 'expiryDate',
        label: 'Date de péremption',
        required: false,
        columnName: null,
        confidence: 0,
        reason: null,
      },
      {
        fieldKey: 'comment',
        label: 'Commentaire',
        required: false,
        columnName: null,
        confidence: 0,
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
      originalname: 'stocks.xlsx',
    }) as Express.Multer.File;

  beforeEach(async () => {
    tx = {
      importLog: {
        update: jest.fn<Promise<unknown>, [Record<string, unknown>]>(),
      },
    };
    prisma = {
      article: { findMany: jest.fn() },
      stockLot: { findMany: jest.fn() },
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
    stockLotsService = { receive: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StocksImportService,
        { provide: PrismaService, useValue: prisma },
        { provide: ImportParserService, useValue: importParserService },
        { provide: ImportLogsService, useValue: importLogsService },
        { provide: ColumnMappingService, useValue: columnMappingService },
        { provide: StockLotsService, useValue: stockLotsService },
      ],
    }).compile();

    service = module.get(StocksImportService);
  });

  const validRawRow = {
    articleReference: 'MP-LAVANDE',
    supplierLotNumber: 'LOT-001',
    receivedQuantity: 200,
    receivedAt: '2026-07-06',
    expiryDate: null,
    comment: null,
  };

  describe('preview', () => {
    it('renvoie uniquement le mapping quand un champ obligatoire est manquant', async () => {
      importParserService.parse.mockReturnValue([{ line: 2, data: {} }]);
      columnMappingService.suggest.mockResolvedValue({
        ...completeSuggestion,
        missingRequiredFields: ['receivedQuantity'],
      });

      const result = await service.preview(siteId, userId, file());

      expect(result.mappingComplete).toBe(false);
      expect(result.toReceive).toBeUndefined();
      expect(columnMappingService.applyToRows).not.toHaveBeenCalled();
      expect(prisma.article.findMany).not.toHaveBeenCalled();
    });

    it('propose la réception pour une référence existante et active, sans avertissement', async () => {
      importParserService.parse.mockReturnValue([{ line: 2, data: {} }]);
      columnMappingService.applyToRows.mockReturnValue([
        { line: 2, values: validRawRow },
      ]);
      prisma.article.findMany.mockResolvedValue([article()]);
      prisma.stockLot.findMany.mockResolvedValue([]);

      const result = await service.preview(siteId, userId, file());

      expect(result.toReceive).toEqual([
        {
          line: 2,
          articleReference: 'MP-LAVANDE',
          supplierLotNumber: 'LOT-001',
          receivedQuantity: 200,
          receivedAt: '2026-07-06',
          expiryDate: null,
          comment: null,
        },
      ]);
      expect(result.warnings).toEqual([]);
      expect(result.errors).toEqual([]);
    });

    it('signale une erreur pour une référence article introuvable', async () => {
      importParserService.parse.mockReturnValue([{ line: 2, data: {} }]);
      columnMappingService.applyToRows.mockReturnValue([
        { line: 2, values: { ...validRawRow, articleReference: 'INCONNU' } },
      ]);
      prisma.article.findMany.mockResolvedValue([]);
      prisma.stockLot.findMany.mockResolvedValue([]);

      const result = await service.preview(siteId, userId, file());

      expect(result.toReceive).toEqual([]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors?.[0]).toMatchObject({
        line: 2,
        articleReference: 'INCONNU',
      });
      expect(result.errors?.[0].message).toContain('introuvable');
    });

    it('signale une erreur bloquante pour un article désactivé', async () => {
      importParserService.parse.mockReturnValue([{ line: 2, data: {} }]);
      columnMappingService.applyToRows.mockReturnValue([
        { line: 2, values: validRawRow },
      ]);
      prisma.article.findMany.mockResolvedValue([article({ active: false })]);
      prisma.stockLot.findMany.mockResolvedValue([]);

      const result = await service.preview(siteId, userId, file());

      expect(result.toReceive).toEqual([]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors?.[0].message).toContain('désactivé');
    });

    it('signale une erreur pour une quantité invalide', async () => {
      importParserService.parse.mockReturnValue([{ line: 2, data: {} }]);
      columnMappingService.applyToRows.mockReturnValue([
        { line: 2, values: { ...validRawRow, receivedQuantity: 0 } },
      ]);
      prisma.article.findMany.mockResolvedValue([article()]);
      prisma.stockLot.findMany.mockResolvedValue([]);

      const result = await service.preview(siteId, userId, file());

      expect(result.errors).toHaveLength(1);
      expect(result.errors?.[0].message).toContain('Quantité reçue invalide');
    });

    it.each([
      ['numéro de série Excel', 46209],
      ['date ISO', '2026-07-06'],
      ['date française', '06/07/2026'],
    ])('accepte une date de réception au format %s', async (_label, raw) => {
      importParserService.parse.mockReturnValue([{ line: 2, data: {} }]);
      columnMappingService.applyToRows.mockReturnValue([
        { line: 2, values: { ...validRawRow, receivedAt: raw } },
      ]);
      prisma.article.findMany.mockResolvedValue([article()]);
      prisma.stockLot.findMany.mockResolvedValue([]);

      const result = await service.preview(siteId, userId, file());

      expect(result.errors).toEqual([]);
      expect(result.toReceive?.[0].receivedAt).toBe('2026-07-06');
    });

    it('signale une erreur pour une date de réception invalide', async () => {
      importParserService.parse.mockReturnValue([{ line: 2, data: {} }]);
      columnMappingService.applyToRows.mockReturnValue([
        { line: 2, values: { ...validRawRow, receivedAt: '31/02/2026' } },
      ]);
      prisma.article.findMany.mockResolvedValue([article()]);
      prisma.stockLot.findMany.mockResolvedValue([]);

      const result = await service.preview(siteId, userId, file());

      expect(result.errors).toHaveLength(1);
      expect(result.errors?.[0].message).toContain(
        'Date de réception invalide',
      );
    });

    it('signale un avertissement (non bloquant) pour un doublon intra-fichier', async () => {
      importParserService.parse.mockReturnValue([
        { line: 2, data: {} },
        { line: 3, data: {} },
      ]);
      columnMappingService.applyToRows.mockReturnValue([
        { line: 2, values: validRawRow },
        { line: 3, values: validRawRow },
      ]);
      prisma.article.findMany.mockResolvedValue([article()]);
      prisma.stockLot.findMany.mockResolvedValue([]);

      const result = await service.preview(siteId, userId, file());

      expect(result.toReceive).toHaveLength(2);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings?.[0]).toMatchObject({ line: 3 });
      expect(result.warnings?.[0].message).toContain(
        'déjà présent dans ce fichier',
      );
    });

    it('signale un avertissement (non bloquant) pour un doublon déjà en base', async () => {
      importParserService.parse.mockReturnValue([{ line: 2, data: {} }]);
      columnMappingService.applyToRows.mockReturnValue([
        { line: 2, values: validRawRow },
      ]);
      prisma.article.findMany.mockResolvedValue([article()]);
      prisma.stockLot.findMany.mockResolvedValue([
        { articleId: 'article-1', supplierLotNumber: 'LOT-001' },
      ]);

      const result = await service.preview(siteId, userId, file());

      expect(result.toReceive).toHaveLength(1);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings?.[0].message).toContain('existe déjà');
    });
  });

  describe('confirm', () => {
    const baseDto: ConfirmStocksImportDto = {
      importLogId: 'import-log-1',
      rows: [
        {
          line: 2,
          articleReference: 'MP-LAVANDE',
          supplierLotNumber: 'LOT-001',
          receivedQuantity: 200,
          receivedAt: '2026-07-06',
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

    it('réceptionne chaque ligne valide via StockLotsService.receive() avec le client transactionnel', async () => {
      prisma.importLog.findFirst.mockResolvedValue({
        id: 'import-log-1',
        status: ImportStatus.PREVISUALISE,
      });
      prisma.article.findMany.mockResolvedValue([article()]);
      prisma.stockLot.findMany.mockResolvedValue([]);
      stockLotsService.receive.mockResolvedValue({ id: 'stock-lot-1' });

      const result = await service.confirm(siteId, userId, baseDto);

      expect(stockLotsService.receive).toHaveBeenCalledWith(
        siteId,
        userId,
        {
          articleId: 'article-1',
          supplierLotNumber: 'LOT-001',
          receivedQuantity: 200,
          receivedAt: '2026-07-06',
          expiryDate: undefined,
          comment: undefined,
        },
        tx,
      );
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
        received: 1,
        errors: [],
      });
    });

    it('revalide entièrement côté serveur : exclut une ligne dont l’article a été désactivé entre-temps', async () => {
      prisma.importLog.findFirst.mockResolvedValue({
        id: 'import-log-1',
        status: ImportStatus.PREVISUALISE,
      });
      prisma.article.findMany.mockResolvedValue([article({ active: false })]);
      prisma.stockLot.findMany.mockResolvedValue([]);

      const result = await service.confirm(siteId, userId, baseDto);

      expect(stockLotsService.receive).not.toHaveBeenCalled();
      expect(result.received).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toContain('désactivé');
    });
  });
});
