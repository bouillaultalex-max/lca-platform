import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ImportParserService } from '../import-parser/import-parser.service';
import { ImportLogsService } from '../import-logs/import-logs.service';
import { ColumnMappingService } from '../../common/column-mapping/column-mapping.service';
import type { MappingCorrection } from '../../common/column-mapping/column-mapping.types';
import {
  OPENSI_MAPPING_CONFIGS,
  IMPORT_SOURCE_OPENSI,
} from '../mapping-configs';
import { parseDecimal, parseRequiredString } from '../value-parsing.util';
import { parseDateToIso } from '../date-parsing.util';
import { StockLotsService } from '../../stock/stock-lots/stock-lots.service';
import {
  Article,
  ImportStatus,
  ImportType,
} from '../../../generated/prisma/client';
import { ConfirmStocksImportDto } from './dto/confirm-stocks-import.dto';
import {
  ParsedStockRow,
  StockImportRowError,
  StockImportRowWarning,
  StocksImportConfirmResult,
  StocksImportPreviewResult,
} from './stocks-import.types';

interface ResolvedStockRow extends ParsedStockRow {
  articleId: string;
}

/**
 * Import Stocks OpenSi : réutilise entièrement `StockLotsService.receive()` pour
 * l'écriture (aucune logique de réception dupliquée ici). Toute l'interprétation des
 * valeurs de fichier (dates, quantités, résolution de référence, doublons) reste
 * propre à ce module — le moteur de mapping et le parseur restent génériques.
 */
@Injectable()
export class StocksImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly importParserService: ImportParserService,
    private readonly importLogsService: ImportLogsService,
    private readonly columnMappingService: ColumnMappingService,
    private readonly stockLotsService: StockLotsService,
  ) {}

  async preview(
    siteId: string,
    userId: string,
    file: Express.Multer.File,
    mappingCorrections: MappingCorrection[] = [],
  ): Promise<StocksImportPreviewResult> {
    const parsedRows = this.importParserService.parse(
      file.buffer,
      file.originalname,
    );
    const headers =
      parsedRows.length > 0 ? Object.keys(parsedRows[0].data) : [];
    const config = OPENSI_MAPPING_CONFIGS[ImportType.STOCKS];

    const baseSuggestion = await this.columnMappingService.suggest(
      siteId,
      IMPORT_SOURCE_OPENSI,
      ImportType.STOCKS,
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
        ImportType.STOCKS,
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

    const parseErrors: StockImportRowError[] = [];
    const parsedStockRows: ParsedStockRow[] = [];
    for (const row of mappedRows) {
      const parsed = this.parseRow(row.line, row.values);
      if ('message' in parsed) {
        parseErrors.push(parsed);
      } else {
        parsedStockRows.push(parsed);
      }
    }

    const classified = await this.classify(siteId, parsedStockRows);
    const errors = [...parseErrors, ...classified.errors];

    const importLog = await this.importLogsService.createPreview(
      siteId,
      userId,
      ImportType.STOCKS,
      file.originalname,
      parsedRows.length,
      errors.map((error) => ({ line: error.line, message: error.message })),
    );

    return {
      importLogId: importLog.id,
      mapping: suggestion,
      mappingComplete: true,
      // `articleId` reste un détail de résolution interne : la confirmation
      // revalide toujours depuis `articleReference`, jamais depuis un id renvoyé
      // ici (voir docs/regles-metier.md §7).
      toReceive: classified.toReceive.map((row) => ({
        line: row.line,
        articleReference: row.articleReference,
        supplierLotNumber: row.supplierLotNumber,
        receivedQuantity: row.receivedQuantity,
        receivedAt: row.receivedAt,
        expiryDate: row.expiryDate,
        comment: row.comment,
      })),
      warnings: classified.warnings,
      errors,
    };
  }

  async confirm(
    siteId: string,
    userId: string,
    dto: ConfirmStocksImportDto,
  ): Promise<StocksImportConfirmResult> {
    const importLog = await this.prisma.importLog.findFirst({
      where: { id: dto.importLogId, siteId, type: ImportType.STOCKS },
    });
    if (!importLog) {
      throw new NotFoundException(
        `Historique d'import ${dto.importLogId} introuvable.`,
      );
    }
    if (importLog.status !== ImportStatus.PREVISUALISE) {
      throw new BadRequestException(
        "Cet import a déjà été validé ou n'est plus en attente de confirmation.",
      );
    }

    // Revalidation intégrale : les lignes soumises sont repassées par la même
    // validation qu'à l'aperçu, jamais un simple recopiage de ce qui a été proposé.
    const parseErrors: StockImportRowError[] = [];
    const parsedRows: ParsedStockRow[] = [];
    for (const row of dto.rows) {
      const parsed = this.parseRow(row.line, {
        articleReference: row.articleReference,
        supplierLotNumber: row.supplierLotNumber,
        receivedQuantity: row.receivedQuantity,
        receivedAt: row.receivedAt,
        expiryDate: row.expiryDate ?? null,
        comment: row.comment ?? null,
      });
      if ('message' in parsed) {
        parseErrors.push(parsed);
      } else {
        parsedRows.push(parsed);
      }
    }

    const classified = await this.classify(siteId, parsedRows);
    const errors = [...parseErrors, ...classified.errors];

    // Une seule transaction pour l'ensemble des réceptions retenues + la mise à jour
    // du journal : StockLotsService.receive() accepte ce client transactionnel et
    // n'ouvre pas sa propre transaction imbriquée (voir ADR — extension apportée à
    // StockLotsService pour ce besoin, réutilisable par tout futur import de masse).
    await this.prisma.$transaction(async (tx) => {
      for (const row of classified.toReceive) {
        await this.stockLotsService.receive(
          siteId,
          userId,
          {
            articleId: row.articleId,
            supplierLotNumber: row.supplierLotNumber,
            receivedQuantity: row.receivedQuantity,
            receivedAt: row.receivedAt,
            expiryDate: row.expiryDate ?? undefined,
            comment: row.comment ?? undefined,
          },
          tx,
        );
      }

      await tx.importLog.update({
        where: { id: importLog.id },
        data: {
          status: ImportStatus.VALIDE,
          processedLines: dto.rows.length,
          errorCount: errors.length,
          errorDetails:
            errors.length > 0
              ? errors.map((error) => ({
                  line: error.line,
                  message: error.message,
                }))
              : undefined,
        },
      });
    });

    return {
      importLogId: importLog.id,
      received: classified.toReceive.length,
      errors,
    };
  }

  private parseRow(
    line: number,
    values: Record<string, unknown>,
  ): ParsedStockRow | StockImportRowError {
    const articleReference = parseRequiredString(values.articleReference);
    if (!articleReference) {
      return { line, message: 'Référence article manquante sur cette ligne.' };
    }
    const supplierLotNumber = parseRequiredString(values.supplierLotNumber);
    if (!supplierLotNumber) {
      return {
        line,
        articleReference,
        message: 'Numéro de lot fournisseur manquant sur cette ligne.',
      };
    }
    const receivedQuantity = parseDecimal(values.receivedQuantity);
    if (receivedQuantity === null || receivedQuantity <= 0) {
      return {
        line,
        articleReference,
        message: `Quantité reçue invalide : "${String(values.receivedQuantity)}".`,
      };
    }
    const receivedAt = parseDateToIso(values.receivedAt);
    if (!receivedAt) {
      return {
        line,
        articleReference,
        message: `Date de réception invalide : "${String(values.receivedAt)}".`,
      };
    }

    let expiryDate: string | null = null;
    const hasExpiryDate =
      values.expiryDate !== null &&
      values.expiryDate !== undefined &&
      values.expiryDate !== '';
    if (hasExpiryDate) {
      expiryDate = parseDateToIso(values.expiryDate);
      if (!expiryDate) {
        return {
          line,
          articleReference,
          message: `Date de péremption invalide : "${String(values.expiryDate)}".`,
        };
      }
    }

    const comment = parseRequiredString(values.comment);

    return {
      line,
      articleReference,
      supplierLotNumber,
      receivedQuantity,
      receivedAt,
      expiryDate,
      comment,
    };
  }

  private async classify(
    siteId: string,
    rows: ParsedStockRow[],
  ): Promise<{
    toReceive: ResolvedStockRow[];
    warnings: StockImportRowWarning[];
    errors: StockImportRowError[];
  }> {
    const errors: StockImportRowError[] = [];

    const references = [...new Set(rows.map((row) => row.articleReference))];
    const articles: Article[] =
      references.length > 0
        ? await this.prisma.article.findMany({
            where: { siteId, openSiReference: { in: references } },
          })
        : [];
    const articleByReference = new Map(
      articles.map((article) => [article.openSiReference, article]),
    );

    const resolvedRows: ResolvedStockRow[] = [];
    for (const row of rows) {
      const article = articleByReference.get(row.articleReference);
      if (!article) {
        errors.push({
          line: row.line,
          articleReference: row.articleReference,
          message: `Référence article "${row.articleReference}" introuvable.`,
        });
        continue;
      }
      if (!article.active) {
        errors.push({
          line: row.line,
          articleReference: row.articleReference,
          message: `L'article "${row.articleReference}" est désactivé : réception impossible.`,
        });
        continue;
      }
      resolvedRows.push({ ...row, articleId: article.id });
    }

    const articleIds = [...new Set(resolvedRows.map((row) => row.articleId))];
    const existingStockLots =
      articleIds.length > 0
        ? await this.prisma.stockLot.findMany({
            where: { siteId, articleId: { in: articleIds } },
          })
        : [];
    const existingPairs = new Set(
      existingStockLots.map(
        (lot) => `${lot.articleId}|${lot.supplierLotNumber}`,
      ),
    );

    const seenInFile = new Map<string, number>();
    const warnings: StockImportRowWarning[] = [];
    const toReceive: ResolvedStockRow[] = [];

    for (const row of resolvedRows) {
      const pairKey = `${row.articleId}|${row.supplierLotNumber}`;
      const firstLine = seenInFile.get(pairKey);
      if (firstLine !== undefined) {
        warnings.push({
          line: row.line,
          articleReference: row.articleReference,
          supplierLotNumber: row.supplierLotNumber,
          message: `Ce lot est déjà présent dans ce fichier (ligne ${firstLine}).`,
        });
      } else {
        seenInFile.set(pairKey, row.line);
        if (existingPairs.has(pairKey)) {
          warnings.push({
            line: row.line,
            articleReference: row.articleReference,
            supplierLotNumber: row.supplierLotNumber,
            message: 'Un lot avec ce numéro existe déjà pour cet article.',
          });
        }
      }
      toReceive.push(row);
    }

    return { toReceive, warnings, errors };
  }
}
