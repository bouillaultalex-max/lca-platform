import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ImportParserService } from '../import-parser/import-parser.service';
import { ImportLogsService } from '../import-logs/import-logs.service';
import { ColumnMappingService } from '../../common/column-mapping/column-mapping.service';
import { normalizeText } from '../../common/column-mapping/string-similarity.util';
import type { MappingCorrection } from '../../common/column-mapping/column-mapping.types';
import {
  OPENSI_MAPPING_CONFIGS,
  IMPORT_SOURCE_OPENSI,
} from '../mapping-configs';
import { parseDecimal, parseRequiredString } from '../value-parsing.util';
import {
  Article,
  ArticleType,
  ImportStatus,
  ImportType,
} from '../../../generated/prisma/client';
import { ConfirmArticlesImportDto } from './dto/confirm-articles-import.dto';
import {
  ArticleFieldChange,
  ArticleImportRowError,
  ArticleImportRowWithDiff,
  ArticlesImportConfirmResult,
  ArticlesImportPreviewResult,
  ParsedArticleRow,
} from './articles-import.types';

/**
 * Dictionnaire fermé (pas de similarité floue) pour interpréter la *valeur* de la
 * colonne "type" : une mauvaise interprétation ici a un impact métier plus grave qu'une
 * colonne mal reconnue. Les clés sont déjà normalisées (voir `normalizeText`) ; on
 * remarque que normaliser le nom brut de l'enum ("MATIERE_PREMIERE") donne exactement
 * le même résultat que normaliser son libellé français ("Matière première"), d'où une
 * seule entrée par type couvre les deux.
 */
const ARTICLE_TYPE_BY_NORMALIZED_LABEL: Record<string, ArticleType> = {
  'matiere premiere': ArticleType.MATIERE_PREMIERE,
  mp: ArticleType.MATIERE_PREMIERE,
  packaging: ArticleType.PACKAGING,
  pack: ArticleType.PACKAGING,
  'produit fini': ArticleType.PRODUIT_FINI,
  pf: ArticleType.PRODUIT_FINI,
};

function resolveArticleType(raw: unknown): ArticleType | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const normalized = normalizeText(String(raw));
  return ARTICLE_TYPE_BY_NORMALIZED_LABEL[normalized] ?? null;
}

function parseUnitCost(raw: unknown): number | null {
  const value = parseDecimal(raw);
  return value !== null && value >= 0 ? value : null;
}

/**
 * Import Articles OpenSi : toute la logique métier (interprétation des valeurs,
 * immutabilité du type, détection des doublons, diff avant/après) vit ici. Le moteur
 * de mapping (`ColumnMappingService`) et le parseur de fichier (`ImportParserService`)
 * restent totalement génériques — cette classe est leur seule consommatrice métier
 * pour les articles.
 */
@Injectable()
export class ArticlesImportService {
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
  ): Promise<ArticlesImportPreviewResult> {
    const parsedRows = this.importParserService.parse(
      file.buffer,
      file.originalname,
    );
    const headers =
      parsedRows.length > 0 ? Object.keys(parsedRows[0].data) : [];
    const config = OPENSI_MAPPING_CONFIGS[ImportType.ARTICLES];

    const baseSuggestion = await this.columnMappingService.suggest(
      siteId,
      IMPORT_SOURCE_OPENSI,
      ImportType.ARTICLES,
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
        ImportType.ARTICLES,
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

    const parseErrors: ArticleImportRowError[] = [];
    const parsedArticleRows: ParsedArticleRow[] = [];
    for (const row of mappedRows) {
      const parsed = this.parseRow(row.line, row.values);
      if ('message' in parsed) {
        parseErrors.push(parsed);
      } else {
        parsedArticleRows.push(parsed);
      }
    }

    const classified = await this.classify(siteId, parsedArticleRows);
    const errors = [...parseErrors, ...classified.errors];

    const importLog = await this.importLogsService.createPreview(
      siteId,
      userId,
      ImportType.ARTICLES,
      file.originalname,
      parsedRows.length,
      errors.map((error) => ({ line: error.line, message: error.message })),
    );

    return {
      importLogId: importLog.id,
      mapping: suggestion,
      mappingComplete: true,
      toCreate: classified.toCreate,
      toUpdate: classified.toUpdate,
      unchanged: classified.unchanged,
      errors,
    };
  }

  async confirm(
    siteId: string,
    userId: string,
    dto: ConfirmArticlesImportDto,
  ): Promise<ArticlesImportConfirmResult> {
    const importLog = await this.prisma.importLog.findFirst({
      where: { id: dto.importLogId, siteId, type: ImportType.ARTICLES },
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

    // Revalidation intégrale : on ne fait jamais confiance aux lignes déjà classées
    // par la prévisualisation, on les repasse par la même validation qu'à l'aperçu.
    const parseErrors: ArticleImportRowError[] = [];
    const parsedRows: ParsedArticleRow[] = [];
    for (const row of dto.rows) {
      const parsed = this.parseRow(row.line, {
        openSiReference: row.openSiReference,
        type: row.type,
        name: row.name,
        unitOfMeasure: row.unitOfMeasure,
        currentUnitCost: row.currentUnitCost,
      });
      if ('message' in parsed) {
        parseErrors.push(parsed);
      } else {
        parsedRows.push(parsed);
      }
    }

    const classified = await this.classify(siteId, parsedRows);
    const errors = [...parseErrors, ...classified.errors];

    const result = await this.prisma.$transaction(async (tx) => {
      for (const row of classified.toCreate) {
        await tx.article.create({
          data: {
            siteId,
            type: row.type,
            openSiReference: row.openSiReference,
            name: row.name,
            unitOfMeasure: row.unitOfMeasure,
            currentUnitCost: row.currentUnitCost,
          },
        });
      }
      for (const row of classified.toUpdate) {
        await tx.article.update({
          where: { id: row.articleId },
          data: {
            name: row.name,
            unitOfMeasure: row.unitOfMeasure,
            currentUnitCost: row.currentUnitCost,
          },
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

      return {
        importLogId: importLog.id,
        created: classified.toCreate.length,
        updated: classified.toUpdate.length,
        errors,
      };
    });

    // Mémorisation des corrections après écriture réussie uniquement (voir ADR 0003 §5) :
    // ColumnMappingService n'accepte pas de client transactionnel, donc cet appel reste
    // hors de la transaction Prisma ci-dessus par choix, pas par oubli.
    if (dto.mappingCorrections && dto.mappingCorrections.length > 0) {
      await this.columnMappingService.learnFromCorrections(
        siteId,
        IMPORT_SOURCE_OPENSI,
        ImportType.ARTICLES,
        dto.mappingCorrections,
      );
    }

    return result;
  }

  private parseRow(
    line: number,
    values: Record<string, unknown>,
  ): ParsedArticleRow | ArticleImportRowError {
    const openSiReference = parseRequiredString(values.openSiReference);
    if (!openSiReference) {
      return { line, message: 'Référence OpenSi manquante sur cette ligne.' };
    }
    const name = parseRequiredString(values.name);
    if (!name) {
      return {
        line,
        openSiReference,
        message: 'Désignation manquante sur cette ligne.',
      };
    }
    const unitOfMeasure = parseRequiredString(values.unitOfMeasure);
    if (!unitOfMeasure) {
      return {
        line,
        openSiReference,
        message: 'Unité de mesure manquante sur cette ligne.',
      };
    }
    const type = resolveArticleType(values.type);
    if (!type) {
      return {
        line,
        openSiReference,
        message: `Type d'article non reconnu : "${String(values.type)}". Valeurs acceptées : Matière première, Packaging, Produit fini.`,
      };
    }
    const currentUnitCost = parseUnitCost(values.currentUnitCost);
    if (currentUnitCost === null) {
      return {
        line,
        openSiReference,
        message: `Coût unitaire invalide : "${String(values.currentUnitCost)}".`,
      };
    }

    return {
      line,
      openSiReference,
      type,
      name,
      unitOfMeasure,
      currentUnitCost,
    };
  }

  private async classify(
    siteId: string,
    rows: ParsedArticleRow[],
  ): Promise<{
    toCreate: ParsedArticleRow[];
    toUpdate: ArticleImportRowWithDiff[];
    unchanged: number;
    errors: ArticleImportRowError[];
  }> {
    const errors: ArticleImportRowError[] = [];

    // Doublons intra-fichier : seule la première occurrence de chaque référence est
    // retenue, les suivantes sont en erreur bloquante (voir docs/regles-metier.md §7).
    const firstLineByReference = new Map<string, number>();
    const dedupedRows: ParsedArticleRow[] = [];
    for (const row of rows) {
      const firstLine = firstLineByReference.get(row.openSiReference);
      if (firstLine !== undefined) {
        errors.push({
          line: row.line,
          openSiReference: row.openSiReference,
          message: `Référence en doublon dans le fichier (déjà utilisée ligne ${firstLine}).`,
        });
        continue;
      }
      firstLineByReference.set(row.openSiReference, row.line);
      dedupedRows.push(row);
    }

    const references = dedupedRows.map((row) => row.openSiReference);
    const existingArticles: Article[] =
      references.length > 0
        ? await this.prisma.article.findMany({
            where: { siteId, openSiReference: { in: references } },
          })
        : [];
    const existingByReference = new Map(
      existingArticles.map((article) => [article.openSiReference, article]),
    );

    const toCreate: ParsedArticleRow[] = [];
    const toUpdate: ArticleImportRowWithDiff[] = [];
    let unchanged = 0;

    for (const row of dedupedRows) {
      const existing = existingByReference.get(row.openSiReference);
      if (!existing) {
        toCreate.push(row);
        continue;
      }

      if (existing.type !== row.type) {
        errors.push({
          line: row.line,
          openSiReference: row.openSiReference,
          message: `Le type ne peut pas être modifié par import (existant : ${existing.type}, fichier : ${row.type}). Désactivez l'article et créez-en un nouveau si le type doit changer.`,
        });
        continue;
      }

      const changes: ArticleFieldChange[] = [];
      if (existing.name !== row.name) {
        changes.push({
          field: 'name',
          label: 'Désignation',
          before: existing.name,
          after: row.name,
        });
      }
      if (existing.unitOfMeasure !== row.unitOfMeasure) {
        changes.push({
          field: 'unitOfMeasure',
          label: 'Unité de mesure',
          before: existing.unitOfMeasure,
          after: row.unitOfMeasure,
        });
      }
      if (!existing.currentUnitCost.equals(row.currentUnitCost)) {
        changes.push({
          field: 'currentUnitCost',
          label: 'Coût unitaire',
          before: existing.currentUnitCost.toNumber(),
          after: row.currentUnitCost,
        });
      }

      if (changes.length === 0) {
        unchanged += 1;
      } else {
        toUpdate.push({ ...row, articleId: existing.id, changes });
      }
    }

    return { toCreate, toUpdate, unchanged, errors };
  }
}
