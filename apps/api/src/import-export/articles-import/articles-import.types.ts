import { ArticleType } from '../../../generated/prisma/client';
import { ColumnMappingSuggestion } from '../../common/column-mapping/column-mapping.types';

/** Ligne entièrement résolue et validée, prête à être créée ou comparée à l'existant. */
export interface ParsedArticleRow {
  line: number;
  openSiReference: string;
  type: ArticleType;
  name: string;
  unitOfMeasure: string;
  currentUnitCost: number;
}

export interface ArticleFieldChange {
  field: 'name' | 'unitOfMeasure' | 'currentUnitCost';
  label: string;
  before: string | number;
  after: string | number;
}

export interface ArticleImportRowWithDiff extends ParsedArticleRow {
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
  toCreate?: ParsedArticleRow[];
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
