import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizeText, similarityRatio } from './string-similarity.util';
import {
  ColumnMappingSuggestion,
  FieldDefinition,
  FieldMappingResult,
  MappedRow,
  MappingConfig,
  MappingCorrection,
  MissingFieldHint,
  SourceRow,
} from './column-mapping.types';

/** Score minimal (sur 100) pour qu'une correspondance soit retenue automatiquement. */
const MIN_CONFIDENCE = 50;
/** Score minimal en dessous duquel une piste n'est même plus mentionnée en repli. */
const MIN_HINT_CONFIDENCE = 30;
/**
 * Version de connecteur appliquée quand l'appelant n'en précise pas (ex: un connecteur
 * qui n'a encore jamais changé de format d'export). Un futur changement de format côté
 * source (ex: nouvel export OpenSi) se déclare avec une nouvelle `sourceVersion` explicite,
 * sans jamais entrer en conflit avec les règles apprises sur l'ancien format.
 */
export const DEFAULT_SOURCE_VERSION = 'default';

interface NormalizedHeader {
  original: string;
  normalized: string;
}

interface ScoredCandidate {
  fieldKey: string;
  header: string;
  score: number;
  reason: string;
}

/**
 * Moteur générique de correspondance colonne → champ, commun à tous les connecteurs
 * (voir ADR 0003). Ne connaît aucun concept métier : uniquement une source, une
 * configuration de champs attendus, et les règles apprises précédemment.
 */
@Injectable()
export class ColumnMappingService {
  constructor(private readonly prisma: PrismaService) {}

  async suggest(
    siteId: string,
    source: string,
    entityType: string,
    headers: string[],
    config: MappingConfig,
    sourceVersion: string = DEFAULT_SOURCE_VERSION,
  ): Promise<ColumnMappingSuggestion> {
    const learnedRules = await this.prisma.columnMappingRule.findMany({
      where: { siteId, source, sourceVersion, entityType },
    });
    const learnedFieldByNormalizedColumn = new Map(
      learnedRules.map((rule) => [rule.columnNameNormalized, rule.fieldKey]),
    );

    const headerEntries: NormalizedHeader[] = headers.map((header) => ({
      original: header,
      normalized: normalizeText(header),
    }));

    const fieldByKey = new Map(
      config.fields.map((field) => [field.key, field]),
    );
    const assignedByField = new Map<
      string,
      { columnName: string; confidence: number; reason: string }
    >();
    const usedHeaders = new Set<string>();

    // 1. Règles apprises lors de précédents imports du même (site, source, version, entityType).
    for (const header of headerEntries) {
      const fieldKey = learnedFieldByNormalizedColumn.get(header.normalized);
      if (
        fieldKey &&
        fieldByKey.has(fieldKey) &&
        !assignedByField.has(fieldKey) &&
        !usedHeaders.has(header.original)
      ) {
        assignedByField.set(fieldKey, {
          columnName: header.original,
          confidence: 100,
          reason: 'Mémorisé lors d’un import précédent.',
        });
        usedHeaders.add(header.original);
      }
    }

    // 2. Correspondances par synonymes pour les champs/colonnes restants.
    const candidates: ScoredCandidate[] = [];
    for (const field of config.fields) {
      if (assignedByField.has(field.key)) continue;
      for (const header of headerEntries) {
        if (usedHeaders.has(header.original)) continue;
        const best = this.scoreAgainstSynonyms(header, field.synonyms);
        if (best) {
          candidates.push({
            fieldKey: field.key,
            header: header.original,
            score: best.score,
            reason: best.reason,
          });
        }
      }
    }

    const autoCandidates = candidates
      .filter((candidate) => candidate.score >= MIN_CONFIDENCE)
      .sort((a, b) => b.score - a.score);
    for (const candidate of autoCandidates) {
      if (
        assignedByField.has(candidate.fieldKey) ||
        usedHeaders.has(candidate.header)
      ) {
        continue;
      }
      assignedByField.set(candidate.fieldKey, {
        columnName: candidate.header,
        confidence: candidate.score,
        reason: candidate.reason,
      });
      usedHeaders.add(candidate.header);
    }

    // 3. Pistes faibles, uniquement pour les champs obligatoires toujours non résolus.
    const hints: MissingFieldHint[] = [];
    for (const field of config.fields) {
      if (!field.required || assignedByField.has(field.key)) continue;
      const bestRemaining = candidates
        .filter(
          (candidate) =>
            candidate.fieldKey === field.key &&
            !usedHeaders.has(candidate.header),
        )
        .sort((a, b) => b.score - a.score)[0];
      if (bestRemaining) {
        // Un candidat ≥ MIN_CONFIDENCE est toujours consommé par l'affectation automatique
        // (ou exclu ici car sa colonne a déjà été prise par un autre champ) : seules des
        // ressemblances faibles peuvent donc encore apparaître à ce stade.
        hints.push({
          fieldKey: field.key,
          label: field.label,
          suggestedColumnName: bestRemaining.header,
          message: `La colonne "${bestRemaining.header}" pourrait correspondre au champ "${field.label}". Voulez-vous l'utiliser ?`,
        });
      }
    }

    const fields: FieldMappingResult[] = config.fields.map((field) => {
      const assigned = assignedByField.get(field.key);
      return {
        fieldKey: field.key,
        label: field.label,
        required: field.required,
        columnName: assigned ? assigned.columnName : null,
        confidence: assigned ? assigned.confidence : 0,
        reason: assigned ? assigned.reason : null,
      };
    });

    const ignoredColumns = headers.filter((header) => !usedHeaders.has(header));
    const missingRequiredFields = fields
      .filter((field) => field.required && field.columnName === null)
      .map((field) => field.fieldKey);

    return { fields, ignoredColumns, missingRequiredFields, hints };
  }

  /**
   * Fusionne des corrections manuelles de l'utilisateur sur une suggestion existante,
   * et recalcule les colonnes ignorées / champs obligatoires manquants en conséquence.
   */
  resolve(
    headers: string[],
    config: MappingConfig,
    baseSuggestion: ColumnMappingSuggestion,
    corrections: MappingCorrection[],
  ): ColumnMappingSuggestion {
    const correctionByField = new Map(
      corrections.map((correction) => [
        correction.fieldKey,
        correction.columnName,
      ]),
    );

    const fields: FieldMappingResult[] = config.fields.map((field) => {
      if (correctionByField.has(field.key)) {
        return {
          fieldKey: field.key,
          label: field.label,
          required: field.required,
          columnName: correctionByField.get(field.key) ?? null,
          confidence: 100,
          reason: 'Correspondance corrigée manuellement.',
        };
      }
      const existing = baseSuggestion.fields.find(
        (result) => result.fieldKey === field.key,
      );
      return (
        existing ?? {
          fieldKey: field.key,
          label: field.label,
          required: field.required,
          columnName: null,
          confidence: 0,
          reason: null,
        }
      );
    });

    const usedColumns = new Set(
      fields
        .map((field) => field.columnName)
        .filter((columnName): columnName is string => columnName !== null),
    );
    const ignoredColumns = headers.filter((header) => !usedColumns.has(header));
    const missingRequiredFields = fields
      .filter((field) => field.required && field.columnName === null)
      .map((field) => field.fieldKey);
    const hints = baseSuggestion.hints.filter((hint) =>
      missingRequiredFields.includes(hint.fieldKey),
    );

    return { fields, ignoredColumns, missingRequiredFields, hints };
  }

  /**
   * Projette les lignes brutes (clé = nom de colonne du fichier) vers des objets
   * indexés par `fieldKey` métier. Aucune coercition de valeur : la conversion et la
   * validation restent entièrement dans les services métier consommateurs.
   */
  applyToRows(
    rows: SourceRow[],
    suggestion: ColumnMappingSuggestion,
  ): MappedRow[] {
    return rows.map((row) => {
      const values: Record<string, string | number | boolean | null> = {};
      for (const field of suggestion.fields) {
        if (field.columnName !== null) {
          values[field.fieldKey] = row.data[field.columnName] ?? null;
        }
      }
      return { line: row.line, values };
    });
  }

  /**
   * Mémorise des corrections pour les imports suivants du même (site, source, version,
   * entityType). À appeler uniquement à la confirmation d'un import, jamais à sa seule
   * prévisualisation.
   */
  async learnFromCorrections(
    siteId: string,
    source: string,
    entityType: string,
    corrections: MappingCorrection[],
    sourceVersion: string = DEFAULT_SOURCE_VERSION,
  ): Promise<void> {
    for (const correction of corrections) {
      const columnNameNormalized = normalizeText(correction.columnName);
      await this.prisma.columnMappingRule.upsert({
        where: {
          siteId_source_sourceVersion_entityType_columnNameNormalized: {
            siteId,
            source,
            sourceVersion,
            entityType,
            columnNameNormalized,
          },
        },
        update: {
          fieldKey: correction.fieldKey,
          columnNameOriginal: correction.columnName,
        },
        create: {
          siteId,
          source,
          sourceVersion,
          entityType,
          columnNameNormalized,
          columnNameOriginal: correction.columnName,
          fieldKey: correction.fieldKey,
        },
      });
    }
  }

  private scoreAgainstSynonyms(
    header: NormalizedHeader,
    synonyms: FieldDefinition['synonyms'],
  ): { score: number; reason: string } | null {
    let best: { score: number; reason: string } | null = null;
    for (const rawSynonym of synonyms) {
      const candidate = this.scoreOne(header, rawSynonym);
      if (candidate && (!best || candidate.score > best.score)) {
        best = candidate;
      }
    }
    return best;
  }

  private scoreOne(
    header: NormalizedHeader,
    rawSynonym: string,
  ): { score: number; reason: string } | null {
    const synonym = normalizeText(rawSynonym);
    if (!synonym || !header.normalized) return null;

    if (header.normalized === synonym) {
      return {
        score: 100,
        reason: `Correspondance exacte avec le synonyme "${synonym}".`,
      };
    }

    if (
      synonym.length >= 2 &&
      header.normalized.length >= 2 &&
      (header.normalized.includes(synonym) ||
        synonym.includes(header.normalized))
    ) {
      return {
        score: 75,
        reason: `La colonne "${header.original}" contient (ou est contenue dans) le synonyme "${synonym}".`,
      };
    }

    const ratio = similarityRatio(header.normalized, synonym);
    const score = Math.round(ratio * 100);
    if (score < MIN_HINT_CONFIDENCE) return null;

    return {
      score,
      reason: `Orthographe proche du synonyme "${synonym}" (similarité ${score}%).`,
    };
  }
}
