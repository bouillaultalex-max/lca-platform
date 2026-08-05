import { ColumnMappingSuggestion } from '../../common/column-mapping/column-mapping.types';

/**
 * Ligne entièrement résolue et validée à partir du fichier Aromathèque, prête à être
 * classée (création / mise à jour / inchangée) contre l'état actuel de la base. Ne
 * porte jamais `siteId`, `active`, `linkedArticleId` ni `importLogId` : ces champs
 * restent hors de portée d'un import (voir docs/regles-metier.md — décisions R&D).
 */
export interface ParsedAromaSampleRow {
  line: number;
  legacyId: string;
  supplierNameRaw: string;
  productName: string;
  supplierReference: string | null;
  category: string;
  rating: number | null;
  stockGrams: number | null;
  pricePerKgEur: number | null;
  /** Toujours au format ISO (AAAA-MM-JJ), voir `date-parsing.util.ts`. */
  addedAt: string | null;
  comment: string | null;
}

export type AromaSampleImportRowStatus = 'create' | 'update' | 'unchanged';

export type AromaSampleImportableField =
  | 'supplierNameRaw'
  | 'productName'
  | 'supplierReference'
  | 'category'
  | 'rating'
  | 'stockGrams'
  | 'pricePerKgEur'
  | 'addedAt'
  | 'comment';

export interface AromaSampleFieldChange {
  field: AromaSampleImportableField;
  label: string;
  before: string | number | null;
  after: string | number | null;
}

/**
 * Ligne valide (déjà dédupliquée par `legacyId`), classée contre l'état actuel de la
 * base au moment de l'appel — cette classification n'entre jamais dans l'empreinte
 * `previewHash` (voir `aroma-samples-import.service.ts` §"Empreinte déterministe").
 */
export interface AromaSampleImportRowWithStatus extends ParsedAromaSampleRow {
  status: AromaSampleImportRowStatus;
  /** Identifiant du `RndAromaSample` existant, uniquement pour `update`/`unchanged`. */
  sampleId: string | null;
  /** Renseigné uniquement pour `status: 'update'`. */
  changes: AromaSampleFieldChange[];
}

export interface AromaSampleImportRowError {
  line: number;
  legacyId?: string;
  message: string;
}

export type AromaSampleDuplicateWarningKind =
  'REFERENCE_FOURNISSEUR_DUPLIQUEE' | 'FOURNISSEUR_PRODUIT_DUPLIQUE';

/**
 * Avertissement non bloquant de doublon potentiel (voir docs/regles-metier.md) :
 * n'exclut jamais la ligne des lignes confirmables, ne modifie rien automatiquement.
 */
export interface AromaSampleImportRowWarning {
  line: number;
  legacyId: string;
  kind: AromaSampleDuplicateWarningKind;
  message: string;
}

export interface AromaSamplesImportPreviewResult {
  importLogId: string;
  mapping: ColumnMappingSuggestion;
  mappingComplete: boolean;
  /** Absent si `mappingComplete` est `false` (mapping incomplet, aucune ligne interprétée). */
  rows?: AromaSampleImportRowWithStatus[];
  toCreate?: number;
  toUpdate?: number;
  unchanged?: number;
  warnings?: AromaSampleImportRowWarning[];
  errors?: AromaSampleImportRowError[];
}

export interface AromaSamplesImportConfirmResult {
  importLogId: string;
  created: number;
  updated: number;
  unchanged: number;
  errors: AromaSampleImportRowError[];
}
