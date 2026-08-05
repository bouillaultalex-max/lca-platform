import { createHash } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ImportParserService } from '../../import-export/import-parser/import-parser.service';
import { ImportLogsService } from '../../import-export/import-logs/import-logs.service';
import { ColumnMappingService } from '../../common/column-mapping/column-mapping.service';
import { normalizeText } from '../../common/column-mapping/string-similarity.util';
import type { MappingCorrection } from '../../common/column-mapping/column-mapping.types';
import { AROMA_SAMPLE_MAPPING_CONFIG } from '../mapping-configs/aroma-sample.mapping-config';
import {
  parseDecimal,
  parseRequiredString,
} from '../../import-export/value-parsing.util';
import { parseDateToIso } from '../../import-export/date-parsing.util';
import {
  ImportStatus,
  ImportType,
  RndAromaSample,
} from '../../../generated/prisma/client';
import { ConfirmAromaSamplesImportDto } from './dto/confirm-aroma-samples-import.dto';
import {
  AromaSampleDuplicateWarningKind,
  AromaSampleFieldChange,
  AromaSampleImportRowError,
  AromaSampleImportRowWarning,
  AromaSampleImportRowWithStatus,
  AromaSamplesImportConfirmResult,
  AromaSamplesImportPreviewResult,
  ParsedAromaSampleRow,
} from './aroma-samples-import.types';

/**
 * Nom exact de la feuille source du fichier Excel Aromathèque (voir RD-01). Cette
 * constante appartient au domaine métier R&D qui la consomme, jamais à
 * `ImportParserService` (moteur générique, agnostique de tout connecteur — voir
 * docs/architecture.md).
 */
const AROMATHEQUE_SHEET_NAME = '🗂 Aromatèque Complète';

/**
 * Source et type d'entité transmis à `ColumnMappingService` pour isoler les règles
 * de mapping mémorisées de cet import de celles des connecteurs OpenSi (voir
 * `aroma-sample.mapping-config.spec.ts`, qui utilise déjà ces mêmes valeurs).
 */
const AROMATHEQUE_IMPORT_SOURCE = 'AROMATHEQUE_EXCEL';
const AROMA_SAMPLE_ENTITY_TYPE = 'AROMA_SAMPLE';

/** Catégorie par défaut quand la colonne est vide (décision métier R&D confirmée). */
const DEFAULT_AROMA_SAMPLE_CATEGORY = 'Autre';

/** Forme canonique d'une ligne, utilisée pour le calcul de l'empreinte `previewHash`. */
interface CanonicalAromaSampleRow {
  legacyId: string;
  supplierNameRaw: string;
  productName: string;
  supplierReference: string | null;
  category: string;
  rating: string | null;
  stockGrams: string | null;
  pricePerKgEur: string | null;
  addedAt: string | null;
  comment: string | null;
}

/** Représentation textuelle stable d'un décimal, indépendante de son origine (virgule française, nombre déjà parsé...). */
function canonicalDecimal(value: number | null): string | null {
  return value === null ? null : value.toString();
}

function canonicalizeRow(row: ParsedAromaSampleRow): CanonicalAromaSampleRow {
  return {
    legacyId: row.legacyId,
    supplierNameRaw: row.supplierNameRaw,
    productName: row.productName,
    supplierReference: row.supplierReference,
    category: row.category,
    rating: canonicalDecimal(row.rating),
    stockGrams: canonicalDecimal(row.stockGrams),
    pricePerKgEur: canonicalDecimal(row.pricePerKgEur),
    addedAt: row.addedAt,
    comment: row.comment,
  };
}

/**
 * Empreinte SHA-256 des lignes confirmables (valides, dédupliquées), pour détecter
 * toute altération des données entre la prévisualisation et la confirmation (voir
 * docs/regles-metier.md §7). Ne couvre jamais les erreurs, les avertissements, ni la
 * classification (création/mise à jour/inchangé) : uniquement le contenu des lignes.
 * Les lignes sont triées par `legacyId` avant sérialisation pour qu'un simple
 * changement d'ordre ne modifie jamais l'empreinte.
 */
function computePreviewHash(rows: ParsedAromaSampleRow[]): string {
  const canonicalRows = rows
    .map(canonicalizeRow)
    .sort((a, b) =>
      a.legacyId < b.legacyId ? -1 : a.legacyId > b.legacyId ? 1 : 0,
    );
  return createHash('sha256')
    .update(JSON.stringify(canonicalRows))
    .digest('hex');
}

function decimalEquals(
  existing: RndAromaSample['rating'],
  value: number | null,
): boolean {
  if (existing === null && value === null) return true;
  if (existing === null || value === null) return false;
  return existing.equals(value);
}

function dateToIsoOrNull(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

/**
 * Import Aromathèque (R&D, voir RD-01 / RD-01C) : toute la logique métier (parsing
 * des valeurs, classification création/mise à jour/inchangé, avertissements de
 * doublons potentiels, empreinte anti-altération) vit ici. Le moteur de mapping
 * (`ColumnMappingService`) et le parseur de fichier (`ImportParserService`) restent
 * totalement génériques — cette classe est leur seule consommatrice pour les
 * échantillons d'aromathèque.
 */
@Injectable()
export class AromaSamplesImportService {
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
  ): Promise<AromaSamplesImportPreviewResult> {
    const parsedRows = this.importParserService.parse(
      file.buffer,
      file.originalname,
      AROMATHEQUE_SHEET_NAME,
    );
    const headers =
      parsedRows.length > 0 ? Object.keys(parsedRows[0].data) : [];

    const baseSuggestion = await this.columnMappingService.suggest(
      siteId,
      AROMATHEQUE_IMPORT_SOURCE,
      AROMA_SAMPLE_ENTITY_TYPE,
      headers,
      AROMA_SAMPLE_MAPPING_CONFIG,
    );
    const suggestion =
      mappingCorrections.length > 0
        ? this.columnMappingService.resolve(
            headers,
            AROMA_SAMPLE_MAPPING_CONFIG,
            baseSuggestion,
            mappingCorrections,
          )
        : baseSuggestion;

    if (suggestion.missingRequiredFields.length > 0) {
      const importLog = await this.importLogsService.createPreview(
        siteId,
        userId,
        ImportType.AROMATHEQUE,
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

    const parseErrors: AromaSampleImportRowError[] = [];
    const parsedAromaSampleRows: ParsedAromaSampleRow[] = [];
    for (const row of mappedRows) {
      const parsed = this.parseRow(row.line, row.values);
      if ('message' in parsed) {
        parseErrors.push(parsed);
      } else {
        parsedAromaSampleRows.push(parsed);
      }
    }

    const classified = await this.classify(siteId, parsedAromaSampleRows);
    const errors = [...parseErrors, ...classified.errors];

    const importLog = await this.importLogsService.createPreview(
      siteId,
      userId,
      ImportType.AROMATHEQUE,
      file.originalname,
      parsedRows.length,
      errors.map((error) => ({ line: error.line, message: error.message })),
    );

    // `ImportLogsService.createPreview()` ne porte pas encore `previewHash` dans sa
    // signature (fondation de schéma seule à RD-01C-1) : l'empreinte est donc écrite
    // ici, immédiatement après la création du journal, via `PrismaService` directement
    // — sans modifier `ImportLogsService` dans ce ticket (voir RD-01C-3).
    const previewHash = computePreviewHash(classified.rows);
    await this.prisma.importLog.update({
      where: { id: importLog.id },
      data: { previewHash },
    });

    return {
      importLogId: importLog.id,
      mapping: suggestion,
      mappingComplete: true,
      rows: classified.rows,
      toCreate: classified.rows.filter((row) => row.status === 'create').length,
      toUpdate: classified.rows.filter((row) => row.status === 'update').length,
      unchanged: classified.rows.filter((row) => row.status === 'unchanged')
        .length,
      warnings: classified.warnings,
      errors,
    };
  }

  async confirm(
    siteId: string,
    userId: string,
    dto: ConfirmAromaSamplesImportDto,
  ): Promise<AromaSamplesImportConfirmResult> {
    const importLog = await this.prisma.importLog.findFirst({
      where: { id: dto.importLogId, siteId, type: ImportType.AROMATHEQUE },
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
    if (!importLog.previewHash) {
      throw new BadRequestException(
        'Cet import ne porte aucune empreinte de prévisualisation valide. Relancez une prévisualisation avant de confirmer.',
      );
    }

    // Revalidation intégrale : on ne fait jamais confiance aux lignes déjà classées
    // par la prévisualisation, on les repasse par la même validation qu'à l'aperçu.
    const parseErrors: AromaSampleImportRowError[] = [];
    const parsedRows: ParsedAromaSampleRow[] = [];
    for (const row of dto.rows) {
      const parsed = this.parseRow(row.line, {
        legacyId: row.legacyId,
        supplierNameRaw: row.supplierNameRaw,
        productName: row.productName,
        supplierReference: row.supplierReference ?? null,
        category: row.category,
        rating: row.rating ?? null,
        stockGrams: row.stockGrams ?? null,
        pricePerKgEur: row.pricePerKgEur ?? null,
        addedAt: row.addedAt ?? null,
        comment: row.comment ?? null,
      });
      if ('message' in parsed) {
        parseErrors.push(parsed);
      } else {
        parsedRows.push(parsed);
      }
    }

    // Anti-altération : l'empreinte des lignes valides reçues doit correspondre
    // exactement à celle calculée à la prévisualisation, avant toute reclassification
    // ou écriture (voir docs/regles-metier.md §7).
    const submittedHash = computePreviewHash(parsedRows);
    if (submittedHash !== importLog.previewHash) {
      throw new BadRequestException(
        'Les lignes soumises ne correspondent plus à la prévisualisation. Relancez une nouvelle prévisualisation avant de confirmer.',
      );
    }

    const classified = await this.classify(siteId, parsedRows);
    const errors = [...parseErrors, ...classified.errors];

    const result = await this.prisma.$transaction(async (tx) => {
      let created = 0;
      let updated = 0;
      let unchanged = 0;

      for (const row of classified.rows) {
        if (row.status === 'create') {
          await tx.rndAromaSample.create({
            data: {
              siteId,
              legacyId: row.legacyId,
              supplierNameRaw: row.supplierNameRaw,
              productName: row.productName,
              supplierReference: row.supplierReference,
              category: row.category,
              rating: row.rating,
              stockGrams: row.stockGrams,
              pricePerKgEur: row.pricePerKgEur,
              addedAt: row.addedAt ? new Date(row.addedAt) : null,
              comment: row.comment,
              importLogId: importLog.id,
            },
          });
          created += 1;
        } else if (row.status === 'update' && row.sampleId) {
          await tx.rndAromaSample.update({
            where: { id: row.sampleId },
            data: {
              supplierNameRaw: row.supplierNameRaw,
              productName: row.productName,
              supplierReference: row.supplierReference,
              category: row.category,
              rating: row.rating,
              stockGrams: row.stockGrams,
              pricePerKgEur: row.pricePerKgEur,
              addedAt: row.addedAt ? new Date(row.addedAt) : null,
              comment: row.comment,
              importLogId: importLog.id,
            },
          });
          updated += 1;
        } else {
          unchanged += 1;
        }
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
        created,
        updated,
        unchanged,
        errors,
      };
    });

    // Mémorisation des corrections après écriture réussie uniquement (voir ADR 0003
    // §5) : ColumnMappingService n'accepte pas de client transactionnel, donc cet
    // appel reste hors de la transaction Prisma ci-dessus par choix, pas par oubli.
    if (dto.mappingCorrections && dto.mappingCorrections.length > 0) {
      await this.columnMappingService.learnFromCorrections(
        siteId,
        AROMATHEQUE_IMPORT_SOURCE,
        AROMA_SAMPLE_ENTITY_TYPE,
        dto.mappingCorrections,
      );
    }

    return result;
  }

  private parseRow(
    line: number,
    values: Record<string, unknown>,
  ): ParsedAromaSampleRow | AromaSampleImportRowError {
    const legacyId = parseRequiredString(values.legacyId);
    if (!legacyId) {
      return {
        line,
        message: 'Identifiant historique manquant sur cette ligne.',
      };
    }
    const supplierNameRaw = parseRequiredString(values.supplierNameRaw);
    if (!supplierNameRaw) {
      return {
        line,
        legacyId,
        message: 'Fournisseur manquant sur cette ligne.',
      };
    }
    const productName = parseRequiredString(values.productName);
    if (!productName) {
      return {
        line,
        legacyId,
        message: 'Produit / arôme manquant sur cette ligne.',
      };
    }

    const supplierReference = parseRequiredString(values.supplierReference);
    const category =
      parseRequiredString(values.category) ?? DEFAULT_AROMA_SAMPLE_CATEGORY;

    let rating: number | null = null;
    const hasRating =
      values.rating !== null &&
      values.rating !== undefined &&
      values.rating !== '';
    if (hasRating) {
      rating = parseDecimal(values.rating);
      if (rating === null) {
        return {
          line,
          legacyId,
          message: `Note invalide : "${String(values.rating)}".`,
        };
      }
    }

    let stockGrams: number | null = null;
    const hasStockGrams =
      values.stockGrams !== null &&
      values.stockGrams !== undefined &&
      values.stockGrams !== '';
    if (hasStockGrams) {
      stockGrams = parseDecimal(values.stockGrams);
      if (stockGrams === null) {
        return {
          line,
          legacyId,
          message: `Stock (g) invalide : "${String(values.stockGrams)}".`,
        };
      }
    }

    let pricePerKgEur: number | null = null;
    const hasPricePerKgEur =
      values.pricePerKgEur !== null &&
      values.pricePerKgEur !== undefined &&
      values.pricePerKgEur !== '';
    if (hasPricePerKgEur) {
      pricePerKgEur = parseDecimal(values.pricePerKgEur);
      if (pricePerKgEur === null) {
        return {
          line,
          legacyId,
          message: `Prix par kg (€) invalide : "${String(values.pricePerKgEur)}".`,
        };
      }
    }

    let addedAt: string | null = null;
    const hasAddedAt =
      values.addedAt !== null &&
      values.addedAt !== undefined &&
      values.addedAt !== '';
    if (hasAddedAt) {
      addedAt = parseDateToIso(values.addedAt);
      if (!addedAt) {
        return {
          line,
          legacyId,
          message: `Date d'ajout invalide : "${String(values.addedAt)}".`,
        };
      }
    }

    const comment = parseRequiredString(values.comment);

    return {
      line,
      legacyId,
      supplierNameRaw,
      productName,
      supplierReference,
      category,
      rating,
      stockGrams,
      pricePerKgEur,
      addedAt,
      comment,
    };
  }

  private async classify(
    siteId: string,
    rows: ParsedAromaSampleRow[],
  ): Promise<{
    rows: AromaSampleImportRowWithStatus[];
    warnings: AromaSampleImportRowWarning[];
    errors: AromaSampleImportRowError[];
  }> {
    const errors: AromaSampleImportRowError[] = [];

    // Doublons intra-fichier par identifiant historique : seule la première
    // occurrence est retenue, les suivantes sont en erreur bloquante (même patron
    // que ArticlesImportService pour openSiReference).
    const firstLineByLegacyId = new Map<string, number>();
    const dedupedRows: ParsedAromaSampleRow[] = [];
    for (const row of rows) {
      const firstLine = firstLineByLegacyId.get(row.legacyId);
      if (firstLine !== undefined) {
        errors.push({
          line: row.line,
          legacyId: row.legacyId,
          message: `Identifiant historique en doublon dans le fichier (déjà utilisé ligne ${firstLine}).`,
        });
        continue;
      }
      firstLineByLegacyId.set(row.legacyId, row.line);
      dedupedRows.push(row);
    }

    const legacyIds = dedupedRows.map((row) => row.legacyId);
    const existingSamples: RndAromaSample[] =
      legacyIds.length > 0
        ? await this.prisma.rndAromaSample.findMany({
            where: { siteId, legacyId: { in: legacyIds } },
          })
        : [];
    const existingByLegacyId = new Map(
      existingSamples.map((sample) => [sample.legacyId, sample]),
    );

    // Base complète du site (indépendante du sous-ensemble ci-dessus), pour la
    // détection des doublons potentiels (référence fournisseur, fournisseur+produit).
    const allSiteSamples = await this.prisma.rndAromaSample.findMany({
      where: { siteId },
      select: {
        legacyId: true,
        supplierReference: true,
        supplierNameRaw: true,
        productName: true,
      },
    });

    const classifiedRows: AromaSampleImportRowWithStatus[] = dedupedRows.map(
      (row) => {
        const existing = existingByLegacyId.get(row.legacyId);
        if (!existing) {
          return { ...row, status: 'create', sampleId: null, changes: [] };
        }
        const changes = this.diffAromaSample(existing, row);
        return {
          ...row,
          status: changes.length === 0 ? 'unchanged' : 'update',
          sampleId: existing.id,
          changes,
        };
      },
    );

    const warnings = this.detectDuplicateWarnings(dedupedRows, allSiteSamples);

    return { rows: classifiedRows, warnings, errors };
  }

  private diffAromaSample(
    existing: RndAromaSample,
    row: ParsedAromaSampleRow,
  ): AromaSampleFieldChange[] {
    const changes: AromaSampleFieldChange[] = [];

    if (existing.supplierNameRaw !== row.supplierNameRaw) {
      changes.push({
        field: 'supplierNameRaw',
        label: 'Fournisseur',
        before: existing.supplierNameRaw,
        after: row.supplierNameRaw,
      });
    }
    if (existing.productName !== row.productName) {
      changes.push({
        field: 'productName',
        label: 'Produit / Arôme',
        before: existing.productName,
        after: row.productName,
      });
    }
    if (existing.supplierReference !== row.supplierReference) {
      changes.push({
        field: 'supplierReference',
        label: 'Référence fournisseur',
        before: existing.supplierReference,
        after: row.supplierReference,
      });
    }
    if (existing.category !== row.category) {
      changes.push({
        field: 'category',
        label: 'Catégorie',
        before: existing.category,
        after: row.category,
      });
    }
    if (!decimalEquals(existing.rating, row.rating)) {
      changes.push({
        field: 'rating',
        label: 'Note',
        before: existing.rating ? existing.rating.toNumber() : null,
        after: row.rating,
      });
    }
    if (!decimalEquals(existing.stockGrams, row.stockGrams)) {
      changes.push({
        field: 'stockGrams',
        label: 'Stock (g)',
        before: existing.stockGrams ? existing.stockGrams.toNumber() : null,
        after: row.stockGrams,
      });
    }
    if (!decimalEquals(existing.pricePerKgEur, row.pricePerKgEur)) {
      changes.push({
        field: 'pricePerKgEur',
        label: 'Prix par kg (€)',
        before: existing.pricePerKgEur
          ? existing.pricePerKgEur.toNumber()
          : null,
        after: row.pricePerKgEur,
      });
    }
    const existingAddedAt = dateToIsoOrNull(existing.addedAt);
    if (existingAddedAt !== row.addedAt) {
      changes.push({
        field: 'addedAt',
        label: "Date d'ajout",
        before: existingAddedAt,
        after: row.addedAt,
      });
    }
    if (existing.comment !== row.comment) {
      changes.push({
        field: 'comment',
        label: 'Commentaire',
        before: existing.comment,
        after: row.comment,
      });
    }

    return changes;
  }

  /**
   * Avertissements non bloquants de doublons potentiels, indépendants de la
   * classification création/mise à jour/inchangé : référence fournisseur dupliquée,
   * ou fournisseur+produit dupliqués — intra-fichier et contre la base existante du
   * site. Comparaison via `normalizeText` (casse, accents, ponctuation, espaces),
   * jamais de rapprochement singulier/pluriel. Les références nulles ou vides sont
   * ignorées. Un échantillon existant n'est jamais signalé comme doublon de lui-même
   * (même `legacyId`).
   */
  private detectDuplicateWarnings(
    rows: ParsedAromaSampleRow[],
    existingSamples: Pick<
      RndAromaSample,
      'legacyId' | 'supplierReference' | 'supplierNameRaw' | 'productName'
    >[],
  ): AromaSampleImportRowWarning[] {
    const warnings: AromaSampleImportRowWarning[] = [];

    const existingByReference = new Map<string, string[]>();
    const existingByNameCombo = new Map<string, string[]>();
    for (const sample of existingSamples) {
      if (sample.supplierReference) {
        const key = normalizeText(sample.supplierReference);
        if (key) {
          const list = existingByReference.get(key) ?? [];
          list.push(sample.legacyId);
          existingByReference.set(key, list);
        }
      }
      const comboKey = `${normalizeText(sample.supplierNameRaw)}|${normalizeText(sample.productName)}`;
      const comboList = existingByNameCombo.get(comboKey) ?? [];
      comboList.push(sample.legacyId);
      existingByNameCombo.set(comboKey, comboList);
    }

    const seenReferenceInFile = new Map<string, number>();
    const seenNameComboInFile = new Map<string, number>();

    for (const row of rows) {
      this.detectReferenceWarning(
        row,
        seenReferenceInFile,
        existingByReference,
        warnings,
      );
      this.detectNameComboWarning(
        row,
        seenNameComboInFile,
        existingByNameCombo,
        warnings,
      );
    }

    return warnings;
  }

  private detectReferenceWarning(
    row: ParsedAromaSampleRow,
    seenInFile: Map<string, number>,
    existingByReference: Map<string, string[]>,
    warnings: AromaSampleImportRowWarning[],
  ): void {
    if (!row.supplierReference) return;
    const key = normalizeText(row.supplierReference);
    if (!key) return;

    const kind: AromaSampleDuplicateWarningKind =
      'REFERENCE_FOURNISSEUR_DUPLIQUEE';
    const firstLine = seenInFile.get(key);
    if (firstLine !== undefined) {
      warnings.push({
        line: row.line,
        legacyId: row.legacyId,
        kind,
        message: `Référence fournisseur déjà utilisée dans ce fichier (ligne ${firstLine}).`,
      });
      return;
    }
    seenInFile.set(key, row.line);

    const matches = existingByReference.get(key) ?? [];
    if (matches.some((legacyId) => legacyId !== row.legacyId)) {
      warnings.push({
        line: row.line,
        legacyId: row.legacyId,
        kind,
        message:
          'Référence fournisseur déjà utilisée par un échantillon existant.',
      });
    }
  }

  private detectNameComboWarning(
    row: ParsedAromaSampleRow,
    seenInFile: Map<string, number>,
    existingByNameCombo: Map<string, string[]>,
    warnings: AromaSampleImportRowWarning[],
  ): void {
    const kind: AromaSampleDuplicateWarningKind =
      'FOURNISSEUR_PRODUIT_DUPLIQUE';
    const key = `${normalizeText(row.supplierNameRaw)}|${normalizeText(row.productName)}`;

    const firstLine = seenInFile.get(key);
    if (firstLine !== undefined) {
      warnings.push({
        line: row.line,
        legacyId: row.legacyId,
        kind,
        message: `Fournisseur et produit déjà utilisés dans ce fichier (ligne ${firstLine}).`,
      });
      return;
    }
    seenInFile.set(key, row.line);

    const matches = existingByNameCombo.get(key) ?? [];
    if (matches.some((legacyId) => legacyId !== row.legacyId)) {
      warnings.push({
        line: row.line,
        legacyId: row.legacyId,
        kind,
        message:
          'Fournisseur et produit déjà utilisés par un échantillon existant.',
      });
    }
  }
}
