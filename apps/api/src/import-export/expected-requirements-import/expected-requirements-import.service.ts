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
import {
  Article,
  ImportStatus,
  ImportType,
} from '../../../generated/prisma/client';
import { ConfirmExpectedRequirementsImportDto } from './dto/confirm-expected-requirements-import.dto';
import {
  ExpectedRequirementRowError,
  ExpectedRequirementsImportConfirmResult,
  ExpectedRequirementsImportPreviewResult,
  ParsedExpectedRequirementRow,
} from './expected-requirements-import.types';

interface ResolvedExpectedRequirementRow extends ParsedExpectedRequirementRow {
  articleId: string;
}

/**
 * Import Besoins attendus OpenSi : journal d'historique **append-only** (voir
 * docs/regles-metier.md §8) — chaque ligne valide crée toujours un nouvel
 * `ExpectedRequirement`, jamais de mise à jour ni de correspondance avec l'existant.
 * Aucune restriction de type d'article : la logique de planification (formule de
 * besoin calculé/quantité suggérée) reste un point ouvert, non tranché ici.
 */
@Injectable()
export class ExpectedRequirementsImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly importParserService: ImportParserService,
    private readonly importLogsService: ImportLogsService,
    private readonly columnMappingService: ColumnMappingService,
  ) {}

  async preview(
    siteId: string,
    userId: string,
    file: Express.Multer.File,
    mappingCorrections: MappingCorrection[] = [],
  ): Promise<ExpectedRequirementsImportPreviewResult> {
    const parsedRows = this.importParserService.parse(
      file.buffer,
      file.originalname,
    );
    const headers =
      parsedRows.length > 0 ? Object.keys(parsedRows[0].data) : [];
    const config = OPENSI_MAPPING_CONFIGS[ImportType.BESOINS_ATTENDUS];

    const baseSuggestion = await this.columnMappingService.suggest(
      siteId,
      IMPORT_SOURCE_OPENSI,
      ImportType.BESOINS_ATTENDUS,
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
        ImportType.BESOINS_ATTENDUS,
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

    const parseErrors: ExpectedRequirementRowError[] = [];
    const parsedRequirementRows: ParsedExpectedRequirementRow[] = [];
    for (const row of mappedRows) {
      const parsed = this.parseRow(row.line, row.values);
      if ('message' in parsed) {
        parseErrors.push(parsed);
      } else {
        parsedRequirementRows.push(parsed);
      }
    }

    const classified = await this.classify(siteId, parsedRequirementRows);
    const errors = [...parseErrors, ...classified.errors];

    const importLog = await this.importLogsService.createPreview(
      siteId,
      userId,
      ImportType.BESOINS_ATTENDUS,
      file.originalname,
      parsedRows.length,
      errors.map((error) => ({ line: error.line, message: error.message })),
    );

    return {
      importLogId: importLog.id,
      mapping: suggestion,
      mappingComplete: true,
      toImport: classified.toImport.map((row) => ({
        line: row.line,
        articleReference: row.articleReference,
        importedRequirement: row.importedRequirement,
        reservedQuantity: row.reservedQuantity,
        importedAt: row.importedAt,
      })),
      errors,
    };
  }

  async confirm(
    siteId: string,
    userId: string,
    dto: ConfirmExpectedRequirementsImportDto,
  ): Promise<ExpectedRequirementsImportConfirmResult> {
    const importLog = await this.prisma.importLog.findFirst({
      where: { id: dto.importLogId, siteId, type: ImportType.BESOINS_ATTENDUS },
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
    const parseErrors: ExpectedRequirementRowError[] = [];
    const parsedRows: ParsedExpectedRequirementRow[] = [];
    for (const row of dto.rows) {
      const parsed = this.parseRow(row.line, {
        articleReference: row.articleReference,
        importedRequirement: row.importedRequirement,
        reservedQuantity: row.reservedQuantity ?? null,
        importedAt: row.importedAt ?? null,
      });
      if ('message' in parsed) {
        parseErrors.push(parsed);
      } else {
        parsedRows.push(parsed);
      }
    }

    const classified = await this.classify(siteId, parsedRows);
    const errors = [...parseErrors, ...classified.errors];

    // Un seul instant pour tout le lot : cohérent avec "cet import a eu lieu à cet
    // instant", plutôt qu'une micro-variance ligne par ligne (voir décision validée).
    const importedAtDefault = new Date();

    await this.prisma.$transaction(async (tx) => {
      if (classified.toImport.length > 0) {
        await tx.expectedRequirement.createMany({
          data: classified.toImport.map((row) => ({
            siteId,
            articleId: row.articleId,
            importedRequirement: row.importedRequirement,
            reservedQuantity: row.reservedQuantity,
            importedAt: row.importedAt
              ? new Date(row.importedAt)
              : importedAtDefault,
          })),
        });
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
      imported: classified.toImport.length,
      errors,
    };
  }

  private parseRow(
    line: number,
    values: Record<string, unknown>,
  ): ParsedExpectedRequirementRow | ExpectedRequirementRowError {
    const articleReference = parseRequiredString(values.articleReference);
    if (!articleReference) {
      return { line, message: 'Référence article manquante sur cette ligne.' };
    }

    const importedRequirement = parseDecimal(values.importedRequirement);
    if (importedRequirement === null || importedRequirement < 0) {
      return {
        line,
        articleReference,
        message: `Besoin attendu invalide : "${String(values.importedRequirement)}".`,
      };
    }

    let reservedQuantity: number | null = null;
    const hasReservedQuantity =
      values.reservedQuantity !== null &&
      values.reservedQuantity !== undefined &&
      values.reservedQuantity !== '';
    if (hasReservedQuantity) {
      reservedQuantity = parseDecimal(values.reservedQuantity);
      if (reservedQuantity === null || reservedQuantity < 0) {
        return {
          line,
          articleReference,
          message: `Quantité réservée invalide : "${String(values.reservedQuantity)}".`,
        };
      }
    }

    let importedAt: string | null = null;
    const hasImportedAt =
      values.importedAt !== null &&
      values.importedAt !== undefined &&
      values.importedAt !== '';
    if (hasImportedAt) {
      importedAt = parseDateToIso(values.importedAt);
      if (!importedAt) {
        return {
          line,
          articleReference,
          message: `Date invalide : "${String(values.importedAt)}".`,
        };
      }
    }

    return {
      line,
      articleReference,
      importedRequirement,
      reservedQuantity,
      importedAt,
    };
  }

  private async classify(
    siteId: string,
    rows: ParsedExpectedRequirementRow[],
  ): Promise<{
    toImport: ResolvedExpectedRequirementRow[];
    errors: ExpectedRequirementRowError[];
  }> {
    const errors: ExpectedRequirementRowError[] = [];

    // Contrairement à Articles/Stocks : aucune notion de doublon ici, chaque ligne
    // est un fait historique indépendant — même référence répétée = deux besoins
    // distincts, tous deux légitimes (voir docs/regles-metier.md §8).
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

    const toImport: ResolvedExpectedRequirementRow[] = [];
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
          message: `L'article "${row.articleReference}" est désactivé : import de besoin impossible.`,
        });
        continue;
      }
      toImport.push({ ...row, articleId: article.id });
    }

    return { toImport, errors };
  }
}
