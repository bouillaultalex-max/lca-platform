import { Injectable, NotImplementedException } from '@nestjs/common';
import { ImportParserService } from '../import-parser/import-parser.service';
import { ImportLogsService } from '../import-logs/import-logs.service';
import { ColumnMappingService } from '../../common/column-mapping/column-mapping.service';
import type { MappingCorrection } from '../../common/column-mapping/column-mapping.types';
import {
  OPENSI_MAPPING_CONFIGS,
  IMPORT_SOURCE_OPENSI,
} from '../mapping-configs';
import { ImportType } from '../../../generated/prisma/client';
import { InventoryImportPreviewResult } from './inventory-import.types';

/**
 * Import Inventaire — **volontairement partiel** (voir décision du 2026-07-06) :
 * sans fichier réel OpenSi, aucune règle de réconciliation n'est codée. Ce service
 * se limite à parser, résoudre le mapping et signaler structurellement si le fichier
 * fournit une granularité par lot fournisseur ou seulement une quantité globale par
 * article — sans jamais valider le contenu des lignes ni écrire en base.
 */
@Injectable()
export class InventoryImportService {
  constructor(
    private readonly importParserService: ImportParserService,
    private readonly importLogsService: ImportLogsService,
    private readonly columnMappingService: ColumnMappingService,
  ) {}

  async preview(
    siteId: string,
    userId: string,
    file: Express.Multer.File,
    mappingCorrections: MappingCorrection[] = [],
  ): Promise<InventoryImportPreviewResult> {
    const parsedRows = this.importParserService.parse(
      file.buffer,
      file.originalname,
    );
    const headers =
      parsedRows.length > 0 ? Object.keys(parsedRows[0].data) : [];
    const config = OPENSI_MAPPING_CONFIGS[ImportType.INVENTAIRE];

    const baseSuggestion = await this.columnMappingService.suggest(
      siteId,
      IMPORT_SOURCE_OPENSI,
      ImportType.INVENTAIRE,
      headers,
      config,
    );
    const suggestion =
      mappingCorrections.length > 0
        ? this.columnMappingService.resolve(
            headers,
            config,
            baseSuggestion,
            mappingCorrections,
          )
        : baseSuggestion;

    if (suggestion.missingRequiredFields.length > 0) {
      const importLog = await this.importLogsService.createPreview(
        siteId,
        userId,
        ImportType.INVENTAIRE,
        file.originalname,
        parsedRows.length,
        [],
      );
      return {
        importLogId: importLog.id,
        mapping: suggestion,
        mappingComplete: false,
      };
    }

    const mappedRows = this.columnMappingService.applyToRows(
      parsedRows,
      suggestion,
    );
    const hasSupplierLotNumber =
      suggestion.fields.find((field) => field.fieldKey === 'supplierLotNumber')
        ?.columnName !== null;

    // Aucune erreur possible ici : sans validation de contenu, tout ce qui a pu
    // être mappé est simplement renvoyé tel quel.
    const importLog = await this.importLogsService.createPreview(
      siteId,
      userId,
      ImportType.INVENTAIRE,
      file.originalname,
      parsedRows.length,
      [],
    );

    return {
      importLogId: importLog.id,
      mapping: suggestion,
      mappingComplete: true,
      hasSupplierLotNumber,
      rows: mappedRows.map((row) => ({
        line: row.line,
        articleReference: row.values.articleReference ?? null,
        countedQuantity: row.values.countedQuantity ?? null,
        supplierLotNumber: row.values.supplierLotNumber ?? null,
      })),
    };
  }

  confirm(): never {
    throw new NotImplementedException(
      "L'import Inventaire n'est pas encore disponible : aucun fichier réel " +
        "OpenSi n'a été observé, la stratégie de réconciliation n'est pas encore définie.",
    );
  }
}
