import { ColumnMappingSuggestion } from '../../common/column-mapping/column-mapping.types';

/** Ligne entièrement résolue et validée, prête à être ajoutée à l'historique. */
export interface ParsedExpectedRequirementRow {
  line: number;
  articleReference: string;
  importedRequirement: number;
  reservedQuantity: number | null;
  /** ISO (AAAA-MM-JJ) si fournie et valide ; `null` si absente — se voit alors
   * attribuer l'instant de la confirmation (voir docs/regles-metier.md §8). */
  importedAt: string | null;
}

export interface ExpectedRequirementRowError {
  line: number;
  articleReference?: string;
  message: string;
}

export interface ExpectedRequirementsImportPreviewResult {
  importLogId: string;
  mapping: ColumnMappingSuggestion;
  mappingComplete: boolean;
  toImport?: ParsedExpectedRequirementRow[];
  errors?: ExpectedRequirementRowError[];
}

export interface ExpectedRequirementsImportConfirmResult {
  importLogId: string;
  imported: number;
  errors: ExpectedRequirementRowError[];
}
