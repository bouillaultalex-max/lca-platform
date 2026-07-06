/**
 * Types du moteur générique de mapping de colonnes (voir ADR 0003). Ce fichier ne
 * contient et ne doit jamais contenir de concept métier (article, stock, OpenSi...) :
 * uniquement la forme générique d'une configuration de champs et de son résultat.
 */

export type FieldValueType = 'string' | 'number' | 'date' | 'boolean';

/**
 * Un champ attendu par une configuration métier donnée. `synonyms` reste du texte
 * "naturel" tel qu'écrit dans le fichier de configuration (ex: "Réf.", "Code OpenSi") ;
 * la normalisation est entièrement gérée par le moteur, jamais par la configuration.
 */
export interface FieldDefinition {
  key: string;
  label: string;
  required: boolean;
  type: FieldValueType;
  synonyms: string[];
}

/**
 * Configuration générique d'un ensemble de champs attendus, définie par un module
 * métier (ex: `import-export/mapping-configs/articles.mapping-config.ts`). Le moteur
 * ne connaît que cette forme, jamais son contenu.
 */
export interface MappingConfig {
  fields: FieldDefinition[];
}

export interface FieldMappingResult {
  fieldKey: string;
  label: string;
  required: boolean;
  columnName: string | null;
  confidence: number;
  reason: string | null;
}

export interface MissingFieldHint {
  fieldKey: string;
  label: string;
  suggestedColumnName: string;
  message: string;
}

export interface ColumnMappingSuggestion {
  fields: FieldMappingResult[];
  ignoredColumns: string[];
  missingRequiredFields: string[];
  hints: MissingFieldHint[];
}

export interface MappingCorrection {
  fieldKey: string;
  columnName: string;
}

/**
 * Ligne source générique (ex: une ligne de fichier déjà parsée) : le moteur ne dépend
 * d'aucun module métier ni d'aucun format de fichier précis, seulement de cette forme.
 */
export interface SourceRow {
  line: number;
  data: Record<string, string | number | boolean | null>;
}

/**
 * Ligne source projetée vers les clés de champ métier (`fieldKey`), sans coercition
 * de valeur : le moteur résout uniquement "quelle colonne va dans quel champ", jamais
 * "que signifie cette valeur" (voir ADR 0003).
 */
export interface MappedRow {
  line: number;
  values: Record<string, string | number | boolean | null>;
}
