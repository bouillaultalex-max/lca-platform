/**
 * Types partagés du module import-export (imports OpenSi). Voir la note dans
 * catalog.ts sur la sérialisation des `Decimal` Prisma en `string`.
 */

import type { ArticleType } from './catalog';

export type ImportType = 'ARTICLES' | 'STOCKS' | 'BESOINS_ATTENDUS' | 'INVENTAIRE';

export const IMPORT_TYPE_LABELS: Record<ImportType, string> = {
  ARTICLES: 'Articles',
  STOCKS: 'Stocks',
  BESOINS_ATTENDUS: 'Besoins attendus',
  INVENTAIRE: 'Inventaire',
};

export type ImportStatus = 'PREVISUALISE' | 'VALIDE' | 'ERREUR';

export const IMPORT_STATUS_LABELS: Record<ImportStatus, string> = {
  PREVISUALISE: 'Prévisualisé',
  VALIDE: 'Réussi',
  ERREUR: 'Échec',
};

/** Résultat du moteur de reconnaissance de colonnes (voir ADR 0003 côté backend). */
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

export interface ImportLog {
  id: string;
  type: ImportType;
  fileName: string;
  importedAt: string;
  status: ImportStatus;
  processedLines: number;
  errorCount: number;
  errorDetails: { line: number; message: string }[] | null;
}

// --- Articles ---------------------------------------------------------------

export interface ArticleImportRow {
  line: number;
  openSiReference: string;
  type: ArticleType;
  name: string;
  unitOfMeasure: string;
  currentUnitCost: number;
}

export interface ArticleFieldChange {
  field: string;
  label: string;
  before: string | number;
  after: string | number;
}

export interface ArticleImportRowWithDiff extends ArticleImportRow {
  articleId: string;
  changes: ArticleFieldChange[];
}

export interface ArticleImportRowError {
  line: number;
  openSiReference?: string;
  message: string;
}

export interface ArticlesImportPreviewResult {
  importLogId: string;
  mapping: ColumnMappingSuggestion;
  mappingComplete: boolean;
  toCreate?: ArticleImportRow[];
  toUpdate?: ArticleImportRowWithDiff[];
  unchanged?: number;
  errors?: ArticleImportRowError[];
}

export interface ArticlesImportConfirmResult {
  importLogId: string;
  created: number;
  updated: number;
  errors: ArticleImportRowError[];
}

// --- Stocks ------------------------------------------------------------------

export interface StockImportRow {
  line: number;
  articleReference: string;
  supplierLotNumber: string;
  receivedQuantity: number;
  receivedAt: string;
  expiryDate: string | null;
  comment: string | null;
}

export interface StockImportRowWarning {
  line: number;
  articleReference: string;
  supplierLotNumber: string;
  message: string;
}

export interface StockImportRowError {
  line: number;
  articleReference?: string;
  message: string;
}

export interface StocksImportPreviewResult {
  importLogId: string;
  mapping: ColumnMappingSuggestion;
  mappingComplete: boolean;
  toReceive?: StockImportRow[];
  warnings?: StockImportRowWarning[];
  errors?: StockImportRowError[];
}

export interface StocksImportConfirmResult {
  importLogId: string;
  received: number;
  errors: StockImportRowError[];
}

// --- Besoins attendus ----------------------------------------------------------

export interface ExpectedRequirementImportRow {
  line: number;
  articleReference: string;
  importedRequirement: number;
  reservedQuantity: number | null;
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
  toImport?: ExpectedRequirementImportRow[];
  errors?: ExpectedRequirementRowError[];
}

export interface ExpectedRequirementsImportConfirmResult {
  importLogId: string;
  imported: number;
  errors: ExpectedRequirementRowError[];
}

// --- Inventaire (partiel) ------------------------------------------------------

export interface RawInventoryRow {
  line: number;
  articleReference: string | number | boolean | null;
  countedQuantity: string | number | boolean | null;
  supplierLotNumber: string | number | boolean | null;
}

export interface InventoryImportPreviewResult {
  importLogId: string;
  mapping: ColumnMappingSuggestion;
  mappingComplete: boolean;
  hasSupplierLotNumber?: boolean;
  rows?: RawInventoryRow[];
}
