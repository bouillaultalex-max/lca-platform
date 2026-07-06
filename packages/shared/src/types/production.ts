/**
 * Types partagés des modules batching/production (Batch/BatchStop/Lot).
 * Voir la note dans catalog.ts sur la sérialisation des `Decimal` Prisma en `string`.
 */

export type BatchStatus = 'PLANIFIE' | 'EN_COURS' | 'TERMINE' | 'ANNULE';

export const BATCH_STATUS_LABELS: Record<BatchStatus, string> = {
  PLANIFIE: 'Planifié',
  EN_COURS: 'En cours',
  TERMINE: 'Terminé',
  ANNULE: 'Annulé',
};

/** Étape du workflow de production, distincte du statut global (voir docs/regles-metier.md §12). */
export type BatchStep = 'PREPARATION' | 'MELANGE' | 'INCORPORATION_TREMIE' | 'CONDITIONNEMENT';

export const BATCH_STEP_LABELS: Record<BatchStep, string> = {
  PREPARATION: 'Préparation',
  MELANGE: 'Mélange',
  INCORPORATION_TREMIE: 'Incorporation trémie',
  CONDITIONNEMENT: 'Conditionnement',
};

export const BATCH_STEP_ORDER: BatchStep[] = [
  'PREPARATION',
  'MELANGE',
  'INCORPORATION_TREMIE',
  'CONDITIONNEMENT',
];

export interface Batch {
  id: string;
  recipeId: string;
  machineId: string;
  format: number;
  plannedQuantity: number;
  producedQuantity: number | null;
  rejectedQuantity: number | null;
  startedAt: string | null;
  endedAt: string | null;
  formatChanged: boolean;
  formatChangeDetail: string | null;
  status: BatchStatus;
  currentStep: BatchStep | null;
  createdAt: string;
}

export interface CreateBatchRequest {
  recipeId: string;
  machineId: string;
  plannedQuantity: number;
}

export interface MaterialQuantity {
  kind: 'MATIERE_PREMIERE';
  articleId: string;
  articleName: string;
  volumeL: number;
  /** `null` si la densité de l'article n'est pas renseignée. */
  massKg: number | null;
}

export interface PackagingQuantity {
  kind: 'PACKAGING';
  articleId: string;
  articleName: string;
  quantity: number;
  unit: string;
}

export type IngredientQuantity = MaterialQuantity | PackagingQuantity;

export interface BatchStop {
  id: string;
  batchId: string;
  reason: string;
  startedAt: string;
  endedAt: string | null;
  durationMinutes: number | null;
}

export interface CreateBatchStopRequest {
  reason: string;
  startedAt: string;
}

export interface EndBatchStopRequest {
  endedAt: string;
}

export interface CloseBatchRequest {
  producedQuantity: number;
  rejectedQuantity: number;
  endedAt: string;
  formatChanged?: boolean;
  formatChangeDetail?: string;
  expiryDate?: string;
}

export interface Lot {
  id: string;
  batchId: string;
  lotNumber: string;
  quantity: number;
  manufacturedAt: string;
  expiryDate: string | null;
  qualityStatus: string;
}

export interface BatchClosureResult {
  batch: Batch;
  lot: Lot;
}
