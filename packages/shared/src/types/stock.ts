/**
 * Types partagés du module stock (StockItem/StockLot/StockMovement).
 * Voir la note dans catalog.ts sur la sérialisation des `Decimal` Prisma en `string`.
 */
import type { Article } from './catalog';

export interface CartonEquivalent {
  fullCartons: number;
  remainderUnits: number;
}

export interface StockItem {
  id: string;
  articleId: string;
  article: Article;
  availableQuantity: string;
  minimumThreshold: string | null;
  /** Calcul d'affichage uniquement ; `null` si Article.unitsPerCarton n'est pas renseigné. */
  cartonEquivalent: CartonEquivalent | null;
  /** `null` si aucun seuil n'est défini. */
  isLowStock: boolean | null;
}

export interface UpdateMinimumThresholdRequest {
  minimumThreshold: number;
}

export interface StockLot {
  id: string;
  articleId: string;
  supplierLotNumber: string;
  receivedQuantity: string;
  remainingQuantity: string;
  receivedAt: string;
  expiryDate: string | null;
}

export interface CreateStockLotRequest {
  articleId: string;
  supplierLotNumber: string;
  receivedQuantity: number;
  receivedAt: string;
  expiryDate?: string;
  comment?: string;
}

export interface AdjustStockLotRequest {
  countedQuantity: number;
  comment?: string;
}

export type StockMovementType = 'ENTREE' | 'SORTIE_BATCH' | 'AJUSTEMENT_INVENTAIRE' | 'EXPORT_OPENSI';

export const STOCK_MOVEMENT_TYPE_LABELS: Record<StockMovementType, string> = {
  ENTREE: 'Entrée',
  SORTIE_BATCH: 'Sortie (batch)',
  AJUSTEMENT_INVENTAIRE: 'Ajustement inventaire',
  EXPORT_OPENSI: 'Export OpenSi',
};

export interface StockMovement {
  id: string;
  articleId: string;
  stockLotId: string | null;
  type: StockMovementType;
  quantity: string;
  movementDate: string;
  comment: string | null;
}
