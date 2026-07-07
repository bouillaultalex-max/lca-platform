import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ArticlesImportService } from './articles-import.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ImportParserService } from '../import-parser/import-parser.service';
import { ImportLogsService } from '../import-logs/import-logs.service';
import { ColumnMappingService } from '../../common/column-mapping/column-mapping.service';
import {
  Article,
  ArticleType,
  ImportStatus,
  ImportType,
  Prisma,
} from '../../../generated/prisma/client';
import { ConfirmArticlesImportDto } from './dto/confirm-articles-import.dto';
import { ColumnMappingSuggestion } from '../../common/column-mapping/column-mapping.types';

describe('ArticlesImportService', () => {
  let service: ArticlesImportService;

  let prisma: {
    article: { findMany: jest.Mock };
    importLog: {
      findFirst: jest.Mock;
    };
    $transaction: jest.Mock<Promise<unknown>, [(tx: unknown) => unknown]>;
  };
  let tx: {
    article: {
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
        fieldKey: 'type',
        label: "Type d'article",
        required: true,
        columnName: 'Type',
        confidence: 100,
        reason: null,
      },
      {
        fieldKey: 'openSiReference',
        label: 'Référence OpenSi',
        required: true,
        columnName: 'Référence',
        confidence: 100,
        reason: null,
      },
      {
        fieldKey: 'name',
        label: 'Désignation',
        required: true,
        columnName: 'Désignation',
        confidence: 100,
        reason: null,
      },
      {
        fieldKey: 'unitOfMeasure',
        label: 'Unité de mesure',
        required: true,
        columnName: 'Unité',
        confidence: 100,
        reason: null,
      },
      {
        fieldKey: 'currentUnitCost',
        label: 'Coût unitaire',
        required: true,
        columnName: 'Prix',
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
      originalname: 'articles.xlsx',
    }) as Express.Multer.File;

  beforeEach(async () => {
    tx = {
      article: {
        create: jest.fn<Promise<unknown>, [Record<string, unknown>]>(),
        update: jest.fn<Promise<unknown>, [Record<string, unknown>]>(),
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
        ArticlesImportService,
        { provide: PrismaService, useValue: prisma },
        { provide: ImportParserService, useValue: importParserService },
        { provide: ImportLogsService, useValue: importLogsService },
        { provide: ColumnMappingService, useValue: columnMappingService },
      ],
    }).compile();

    service = module.get(ArticlesImportService);
  });

  describe('preview', () => {
    it('renvoie uniquement le mapping quand un champ obligatoire est manquant', async () => {
      importParserService.parse.mockReturnValue([
        { line: 2, data: { Référence: 'MP-1' } },
      ]);
      columnMappingService.suggest.mockResolvedValue({
        ...completeSuggestion,
        missingRequiredFields: ['currentUnitCost'],
      });

      const result = await service.preview(siteId, userId, file());

      expect(result.mappingComplete).toBe(false);
      expect(result.toCreate).toBeUndefined();
      expect(columnMappingService.applyToRows).not.toHaveBeenCalled();
      expect(prisma.article.findMany).not.toHaveBeenCalled();
      expect(importLogsService.createPreview).toHaveBeenCalledWith(
        siteId,
        userId,
        ImportType.ARTICLES,
        'articles.xlsx',
        1,
        [],
      );
    });

    it('classe une nouvelle référence en création', async () => {
      importParserService.parse.mockReturnValue([{ line: 2, data: {} }]);
      columnMappingService.applyToRows.mockReturnValue([
        {
          line: 2,
          values: {
            type: 'Matière première',
            openSiReference: 'MP-NOUVEAU',
            name: 'Nouvel article',
            unitOfMeasure: 'L',
            currentUnitCost: 9.9,
          },
        },
      ]);
      prisma.article.findMany.mockResolvedValue([]);

      const result = await service.preview(siteId, userId, file());

      expect(result.toCreate).toEqual([
        {
          line: 2,
          openSiReference: 'MP-NOUVEAU',
          type: ArticleType.MATIERE_PREMIERE,
          name: 'Nouvel article',
          unitOfMeasure: 'L',
          currentUnitCost: 9.9,
        },
      ]);
      expect(result.toUpdate).toEqual([]);
      expect(result.unchanged).toBe(0);
      expect(result.errors).toEqual([]);
    });

    it('classe une référence existante modifiée en mise à jour, avec le diff', async () => {
      importParserService.parse.mockReturnValue([{ line: 2, data: {} }]);
      columnMappingService.applyToRows.mockReturnValue([
        {
          line: 2,
          values: {
            type: 'MATIERE_PREMIERE',
            openSiReference: 'MP-LAVANDE',
            name: 'Parfum ambiance lavande',
            unitOfMeasure: 'L',
            currentUnitCost: 13.2,
          },
        },
      ]);
      prisma.article.findMany.mockResolvedValue([article()]);

      const result = await service.preview(siteId, userId, file());

      expect(result.toCreate).toEqual([]);
      expect(result.toUpdate).toEqual([
        {
          line: 2,
          openSiReference: 'MP-LAVANDE',
          type: ArticleType.MATIERE_PREMIERE,
          name: 'Parfum ambiance lavande',
          unitOfMeasure: 'L',
          currentUnitCost: 13.2,
          articleId: 'article-1',
          changes: [
            {
              field: 'name',
              label: 'Désignation',
              before: 'Parfum lavande',
              after: 'Parfum ambiance lavande',
            },
            {
              field: 'currentUnitCost',
              label: 'Coût unitaire',
              before: 12.5,
              after: 13.2,
            },
          ],
        },
      ]);
    });

    it('compte une référence existante sans changement réel comme inchangée, sans la lister', async () => {
      importParserService.parse.mockReturnValue([{ line: 2, data: {} }]);
      columnMappingService.applyToRows.mockReturnValue([
        {
          line: 2,
          values: {
            type: 'MATIERE_PREMIERE',
            openSiReference: 'MP-LAVANDE',
            name: 'Parfum lavande',
            unitOfMeasure: 'L',
            currentUnitCost: 12.5,
          },
        },
      ]);
      prisma.article.findMany.mockResolvedValue([article()]);

      const result = await service.preview(siteId, userId, file());

      expect(result.toUpdate).toEqual([]);
      expect(result.unchanged).toBe(1);
    });

    it("signale une erreur de ligne pour un type d'article non reconnu", async () => {
      importParserService.parse.mockReturnValue([{ line: 2, data: {} }]);
      columnMappingService.applyToRows.mockReturnValue([
        {
          line: 2,
          values: {
            type: 'inconnu',
            openSiReference: 'MP-X',
            name: 'X',
            unitOfMeasure: 'L',
            currentUnitCost: 1,
          },
        },
      ]);
      prisma.article.findMany.mockResolvedValue([]);

      const result = await service.preview(siteId, userId, file());

      expect(result.toCreate).toEqual([]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors?.[0]).toMatchObject({
        line: 2,
        openSiReference: 'MP-X',
      });
      expect(result.errors?.[0].message).toContain(
        "Type d'article non reconnu",
      );
    });

    it('signale une erreur de ligne pour un coût unitaire invalide', async () => {
      importParserService.parse.mockReturnValue([{ line: 2, data: {} }]);
      columnMappingService.applyToRows.mockReturnValue([
        {
          line: 2,
          values: {
            type: 'Packaging',
            openSiReference: 'PKG-1',
            name: 'Bouchon',
            unitOfMeasure: 'unité',
            currentUnitCost: 'abc',
          },
        },
      ]);
      prisma.article.findMany.mockResolvedValue([]);

      const result = await service.preview(siteId, userId, file());

      expect(result.errors).toHaveLength(1);
      expect(result.errors?.[0]).toMatchObject({
        line: 2,
        openSiReference: 'PKG-1',
      });
      expect(result.errors?.[0].message).toContain('Coût unitaire invalide');
    });

    it('accepte une virgule décimale française pour le coût unitaire', async () => {
      importParserService.parse.mockReturnValue([{ line: 2, data: {} }]);
      columnMappingService.applyToRows.mockReturnValue([
        {
          line: 2,
          values: {
            type: 'PACKAGING',
            openSiReference: 'PKG-2',
            name: 'Étiquette',
            unitOfMeasure: 'unité',
            currentUnitCost: '9,90',
          },
        },
      ]);
      prisma.article.findMany.mockResolvedValue([]);

      const result = await service.preview(siteId, userId, file());

      expect(result.errors).toEqual([]);
      expect(result.toCreate?.[0]).toMatchObject({ currentUnitCost: 9.9 });
    });

    it('signale une erreur bloquante pour une référence dupliquée dans le fichier', async () => {
      importParserService.parse.mockReturnValue([
        { line: 2, data: {} },
        { line: 3, data: {} },
      ]);
      const rawRow = {
        type: 'PRODUIT_FINI',
        openSiReference: 'PF-1',
        name: 'Produit',
        unitOfMeasure: 'unité',
        currentUnitCost: 5,
      };
      columnMappingService.applyToRows.mockReturnValue([
        { line: 2, values: rawRow },
        { line: 3, values: rawRow },
      ]);
      prisma.article.findMany.mockResolvedValue([]);

      const result = await service.preview(siteId, userId, file());

      expect(result.toCreate).toHaveLength(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors?.[0]).toMatchObject({
        line: 3,
        openSiReference: 'PF-1',
      });
      expect(result.errors?.[0].message).toContain('doublon');
    });

    it('signale une erreur si le fichier tente de modifier le type d’un article existant', async () => {
      importParserService.parse.mockReturnValue([{ line: 2, data: {} }]);
      columnMappingService.applyToRows.mockReturnValue([
        {
          line: 2,
          values: {
            type: 'Packaging',
            openSiReference: 'MP-LAVANDE',
            name: 'Parfum lavande',
            unitOfMeasure: 'L',
            currentUnitCost: 12.5,
          },
        },
      ]);
      prisma.article.findMany.mockResolvedValue([article()]);

      const result = await service.preview(siteId, userId, file());

      expect(result.toUpdate).toEqual([]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors?.[0]).toMatchObject({
        line: 2,
        openSiReference: 'MP-LAVANDE',
      });
      expect(result.errors?.[0].message).toContain(
        'type ne peut pas être modifié',
      );
    });

    it('applique les corrections de mapping fournies via resolve()', async () => {
      importParserService.parse.mockReturnValue([{ line: 2, data: {} }]);
      const resolved = { ...completeSuggestion };
      columnMappingService.resolve.mockReturnValue(resolved);
      columnMappingService.applyToRows.mockReturnValue([]);
      prisma.article.findMany.mockResolvedValue([]);

      const corrections = [{ fieldKey: 'name', columnName: 'Libellé' }];
      await service.preview(siteId, userId, file(), corrections);

      expect(columnMappingService.resolve).toHaveBeenCalledWith(
        expect.any(Array),
        expect.anything(),
        completeSuggestion,
        corrections,
      );
      expect(columnMappingService.applyToRows).toHaveBeenCalledWith(
        expect.any(Array),
        resolved,
      );
    });
  });

  describe('confirm', () => {
    const baseDto: ConfirmArticlesImportDto = {
      importLogId: 'import-log-1',
      rows: [
        {
          line: 2,
          openSiReference: 'MP-NOUVEAU',
          type: ArticleType.MATIERE_PREMIERE,
          name: 'Nouvel article',
          unitOfMeasure: 'L',
          currentUnitCost: 9.9,
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

    it('crée les nouveaux articles et met à jour le journal, sans toucher aux champs propres au MES', async () => {
      prisma.importLog.findFirst.mockResolvedValue({
        id: 'import-log-1',
        status: ImportStatus.PREVISUALISE,
      });
      prisma.article.findMany.mockResolvedValue([]);

      const result = await service.confirm(siteId, userId, baseDto);

      expect(tx.article.create).toHaveBeenCalledWith({
        data: {
          siteId,
          type: ArticleType.MATIERE_PREMIERE,
          openSiReference: 'MP-NOUVEAU',
          name: 'Nouvel article',
          unitOfMeasure: 'L',
          currentUnitCost: 9.9,
        },
      });
      const createCall = tx.article.create.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(createCall.data).not.toHaveProperty('active');
      expect(createCall.data).not.toHaveProperty('unitsPerCarton');
      expect(createCall.data).not.toHaveProperty('densityKgPerL');

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
        created: 1,
        updated: 0,
        errors: [],
      });
    });

    it('met à jour un article existant sans jamais inclure active/unitsPerCarton/densityKgPerL', async () => {
      prisma.importLog.findFirst.mockResolvedValue({
        id: 'import-log-1',
        status: ImportStatus.PREVISUALISE,
      });
      prisma.article.findMany.mockResolvedValue([article()]);

      const dto: ConfirmArticlesImportDto = {
        importLogId: 'import-log-1',
        rows: [
          {
            line: 2,
            openSiReference: 'MP-LAVANDE',
            type: ArticleType.MATIERE_PREMIERE,
            name: 'Parfum ambiance lavande',
            unitOfMeasure: 'L',
            currentUnitCost: 13.2,
          },
        ],
      };

      await service.confirm(siteId, userId, dto);

      expect(tx.article.update).toHaveBeenCalledWith({
        where: { id: 'article-1' },
        data: {
          name: 'Parfum ambiance lavande',
          unitOfMeasure: 'L',
          currentUnitCost: 13.2,
        },
      });
    });

    it('revalide entièrement côté serveur : rejette une ligne dont le type a changé depuis la prévisualisation', async () => {
      prisma.importLog.findFirst.mockResolvedValue({
        id: 'import-log-1',
        status: ImportStatus.PREVISUALISE,
      });
      // L'article a été modifié entre l'aperçu et la confirmation : son type ne
      // correspond plus à ce que la ligne soumise indique.
      prisma.article.findMany.mockResolvedValue([
        article({ type: ArticleType.PACKAGING }),
      ]);

      const dto: ConfirmArticlesImportDto = {
        importLogId: 'import-log-1',
        rows: [
          {
            line: 2,
            openSiReference: 'MP-LAVANDE',
            type: ArticleType.MATIERE_PREMIERE,
            name: 'Parfum lavande',
            unitOfMeasure: 'L',
            currentUnitCost: 12.5,
          },
        ],
      };

      const result = await service.confirm(siteId, userId, dto);

      expect(tx.article.update).not.toHaveBeenCalled();
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({ line: 2 });
      expect(result.errors[0].message).toContain(
        'type ne peut pas être modifié',
      );
    });

    it('mémorise les corrections de mapping après la transaction, uniquement si fournies', async () => {
      prisma.importLog.findFirst.mockResolvedValue({
        id: 'import-log-1',
        status: ImportStatus.PREVISUALISE,
      });
      prisma.article.findMany.mockResolvedValue([]);

      const corrections = [{ fieldKey: 'name', columnName: 'Libellé' }];
      await service.confirm(siteId, userId, {
        ...baseDto,
        mappingCorrections: corrections,
      });

      expect(columnMappingService.learnFromCorrections).toHaveBeenCalledWith(
        siteId,
        'OPENSI',
        ImportType.ARTICLES,
        corrections,
      );
    });

    it("n'appelle pas learnFromCorrections quand aucune correction n'est fournie", async () => {
      prisma.importLog.findFirst.mockResolvedValue({
        id: 'import-log-1',
        status: ImportStatus.PREVISUALISE,
      });
      prisma.article.findMany.mockResolvedValue([]);

      await service.confirm(siteId, userId, baseDto);

      expect(columnMappingService.learnFromCorrections).not.toHaveBeenCalled();
    });
  });
});
