import { ColumnMappingSuggestion } from '../../common/column-mapping/column-mapping.types';

/** Ligne entièrement résolue et validée, prête à être réceptionnée. */
export interface ParsedStockRow {
  line: number;
  articleReference: string;
  supplierLotNumber: string;
  receivedQuantity: number;
  receivedAt: string;
  expiryDate: string | null;
  comment: string | null;
}

export interface StockImportRowError {
  line: number;
  articleReference?: string;
  message: string;
}

export interface StockImportRowWarning {
  line: number;
  articleReference: string;
  supplierLotNumber: string;
  message: string;
}

export interface StocksImportPreviewResult {
  importLogId: string;
  mapping: ColumnMappingSuggestion;
  mappingComplete: boolean;
  toReceive?: ParsedStockRow[];
  warnings?: StockImportRowWarning[];
  errors?: StockImportRowError[];
}

export interface StocksImportConfirmResult {
  importLogId: string;
  received: number;
  errors: StockImportRowError[];
}
