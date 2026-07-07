import { NotImplementedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { InventoryImportService } from './inventory-import.service';
import { ImportParserService } from '../import-parser/import-parser.service';
import { ImportLogsService } from '../import-logs/import-logs.service';
import { ColumnMappingService } from '../../common/column-mapping/column-mapping.service';
import { ColumnMappingSuggestion } from '../../common/column-mapping/column-mapping.types';

describe('InventoryImportService', () => {
  let service: InventoryImportService;

  let importParserService: { parse: jest.Mock };
  let importLogsService: { createPreview: jest.Mock };
  let columnMappingService: {
    suggest: jest.Mock;
    resolve: jest.Mock;
    applyToRows: jest.Mock;
  };

  const siteId = 'site-1';
  const userId = 'user-1';

  const suggestionWithLot: ColumnMappingSuggestion = {
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
        fieldKey: 'countedQuantity',
        label: 'Quantité comptée',
        required: true,
        columnName: 'Quantité',
        confidence: 100,
        reason: null,
      },
      {
        fieldKey: 'supplierLotNumber',
        label: 'Lot fournisseur',
        required: false,
        columnName: 'Lot',
        confidence: 100,
        reason: null,
      },
    ],
    ignoredColumns: [],
    missingRequiredFields: [],
    hints: [],
  };

  const suggestionWithoutLot: ColumnMappingSuggestion = {
    ...suggestionWithLot,
    fields: suggestionWithLot.fields.map((field) =>
      field.fieldKey === 'supplierLotNumber'
        ? { ...field, columnName: null, confidence: 0 }
        : field,
    ),
  };

  const file = (): Express.Multer.File =>
    ({
      buffer: Buffer.from('fake'),
      originalname: 'inventaire.xlsx',
    }) as Express.Multer.File;

  beforeEach(async () => {
    importParserService = { parse: jest.fn() };
    importLogsService = {
      createPreview: jest.fn().mockResolvedValue({ id: 'import-log-1' }),
    };
    columnMappingService = {
      suggest: jest.fn().mockResolvedValue(suggestionWithLot),
      resolve: jest.fn(),
      applyToRows: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryImportService,
        { provide: ImportParserService, useValue: importParserService },
        { provide: ImportLogsService, useValue: importLogsService },
        { provide: ColumnMappingService, useValue: columnMappingService },
      ],
    }).compile();

    service = module.get(InventoryImportService);
  });

  describe('preview', () => {
    it('renvoie uniquement le mapping quand un champ obligatoire est manquant', async () => {
      importParserService.parse.mockReturnValue([{ line: 2, data: {} }]);
      columnMappingService.suggest.mockResolvedValue({
        ...suggestionWithLot,
        missingRequiredFields: ['countedQuantity'],
      });

      const result = await service.preview(siteId, userId, file());

      expect(result.mappingComplete).toBe(false);
      expect(result.rows).toBeUndefined();
      expect(result.hasSupplierLotNumber).toBeUndefined();
      expect(columnMappingService.applyToRows).not.toHaveBeenCalled();
      expect(importLogsService.createPreview).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        1,
        [],
      );
    });

    it('détecte la granularité par lot quand la colonne est mappée', async () => {
      importParserService.parse.mockReturnValue([{ line: 2, data: {} }]);
      columnMappingService.applyToRows.mockReturnValue([
        {
          line: 2,
          values: {
            articleReference: 'MP-1',
            countedQuantity: 42,
            supplierLotNumber: 'LOT-1',
          },
        },
      ]);

      const result = await service.preview(siteId, userId, file());

      expect(result.hasSupplierLotNumber).toBe(true);
    });

    it('détecte une quantité globale par article quand la colonne lot est absente', async () => {
      columnMappingService.suggest.mockResolvedValue(suggestionWithoutLot);
      importParserService.parse.mockReturnValue([{ line: 2, data: {} }]);
      columnMappingService.applyToRows.mockReturnValue([
        {
          line: 2,
          values: {
            articleReference: 'MP-1',
            countedQuantity: 42,
          },
        },
      ]);

      const result = await service.preview(siteId, userId, file());

      expect(result.hasSupplierLotNumber).toBe(false);
    });

    it('renvoie les lignes telles quelles, sans aucune validation de contenu', async () => {
      importParserService.parse.mockReturnValue([{ line: 2, data: {} }]);
      columnMappingService.applyToRows.mockReturnValue([
        {
          line: 2,
          values: {
            articleReference: 'REFERENCE-INCONNUE',
            countedQuantity: 'pas-un-nombre',
            supplierLotNumber: null,
          },
        },
      ]);

      const result = await service.preview(siteId, userId, file());

      expect(result.rows).toEqual([
        {
          line: 2,
          articleReference: 'REFERENCE-INCONNUE',
          countedQuantity: 'pas-un-nombre',
          supplierLotNumber: null,
        },
      ]);
    });

    it("ne signale jamais d'erreur, même sur des lignes manifestement invalides", async () => {
      importParserService.parse.mockReturnValue([
        { line: 2, data: {} },
        { line: 3, data: {} },
      ]);
      columnMappingService.applyToRows.mockReturnValue([
        {
          line: 2,
          values: {
            articleReference: null,
            countedQuantity: -999,
            supplierLotNumber: null,
          },
        },
        {
          line: 3,
          values: {
            articleReference: 'MP-1',
            countedQuantity: 'abc',
            supplierLotNumber: null,
          },
        },
      ]);

      await service.preview(siteId, userId, file());

      expect(importLogsService.createPreview).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        2,
        [],
      );
    });
  });

  describe('confirm', () => {
    it('lève NotImplementedException avec un message explicite', () => {
      expect(() => service.confirm()).toThrow(NotImplementedException);
      expect(() => service.confirm()).toThrow(
        /aucun fichier réel.*OpenSi.*observé/i,
      );
    });

    it('ne fait appel à aucun des services injectés', () => {
      try {
        service.confirm();
      } catch {
        // attendu
      }

      expect(importParserService.parse).not.toHaveBeenCalled();
      expect(importLogsService.createPreview).not.toHaveBeenCalled();
      expect(columnMappingService.suggest).not.toHaveBeenCalled();
    });
  });
});
