import { ColumnMappingSuggestion } from '../../common/column-mapping/column-mapping.types';

/**
 * Ligne renvoyée telle quelle, sans aucune validation de contenu (voir décision du
 * 2026-07-06) : ni résolution d'article, ni vérification de quantité, ni détection
 * de doublon. Tant que la stratégie de réconciliation n'est pas définie (en attente
 * d'un fichier réel OpenSi), valider le contenu reviendrait à en présupposer une partie.
 */
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
  /**
   * Signal purement structurel (présence ou non de la colonne `supplierLotNumber`
   * dans le mapping résolu) : true = granularité par lot détectée, false = quantité
   * globale par article. Ne décide de rien, se contente d'observer.
   */
  hasSupplierLotNumber?: boolean;
  rows?: RawInventoryRow[];
}
