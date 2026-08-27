import type { Batch, BatchPrintData, IngredientQuantity } from '@lca-mes/shared';

/**
 * Condition d'affichage du bouton "Imprimer les étiquettes" (voir ADR 0010,
 * étape 7) : uniquement un batch `EN_COURS` avec un numéro de lot ET une DDM
 * réservés — jamais `PLANIFIE`/`ANNULE`/`TERMINE`, jamais une réservation
 * partielle (état normalement impossible, défense en profondeur côté
 * affichage ; le backend refuse de toute façon explicitement, voir
 * BatchPrintService). Fonction pure, testée directement (voir
 * productionLabels.spec.ts).
 */
export function canPrintBatchLabels(
  batch: Pick<Batch, 'status' | 'reservedLotNumber' | 'reservedExpiryDate'>,
): boolean {
  return (
    batch.status === 'EN_COURS' &&
    batch.reservedLotNumber !== null &&
    batch.reservedExpiryDate !== null
  );
}

/**
 * Représentation d'une étiquette physique unique, dérivée de `BatchPrintData`
 * (voir ADR 0010 § Décisions 16/17). Fonction pure, seule source de vérité pour
 * `ProductionBatchPrint.tsx` : testée directement ici (voir productionLabels.spec.ts)
 * en l'absence d'infrastructure de rendu React dans ce dépôt (aucune dépendance
 * de test supplémentaire introduite pour cette étape, voir ADR 0010 § Plan de
 * tests) — le composant de rendu ne fait qu'itérer sur son résultat, sans
 * dupliquer cette logique.
 */
export interface PrintLabelViewModel {
  /** Identifiant stable pour une clé React (`allocationId` + type d'étiquette) —
   * jamais `lotNumber` seul, potentiellement partagé par plusieurs allocations
   * (ADR 0010 § Décision 16). */
  id: string;
  kind: 'PRODUIT' | 'BATCHING';
  allocationId: string | null;
  productName: string;
  lotNumber: string;
  expiryDate: string;
  quantityToBatch: number;
  /** Résultat complet de `computeIngredientQuantities` pour cette allocation
   * (matière première + packaging, PG/VG inclus) — utilisé uniquement par
   * l'étiquette BATCHING, ignoré par l'étiquette PRODUIT. */
  ingredients: IngredientQuantity[];
}

/**
 * Deux étiquettes par allocation (PRODUIT puis BATCHING), dans l'ordre des
 * allocations retourné par le backend (déterministe, voir BatchPrintService) —
 * jamais fusionnées, numéro de lot et DDM communs propagés tels quels depuis
 * `data`, jamais recalculés.
 */
export function buildPrintLabels(data: BatchPrintData): PrintLabelViewModel[] {
  return data.allocations.flatMap((allocation) => {
    const labelKey = allocation.allocationId ?? 'sans-allocation';
    return [
      {
        id: `${labelKey}-produit`,
        kind: 'PRODUIT' as const,
        allocationId: allocation.allocationId,
        productName: allocation.productName,
        lotNumber: data.lotNumber,
        expiryDate: data.expiryDate,
        quantityToBatch: allocation.quantityToBatch,
        ingredients: [],
      },
      {
        id: `${labelKey}-batching`,
        kind: 'BATCHING' as const,
        allocationId: allocation.allocationId,
        productName: allocation.productName,
        lotNumber: data.lotNumber,
        expiryDate: data.expiryDate,
        quantityToBatch: allocation.quantityToBatch,
        ingredients: allocation.ingredients,
      },
    ];
  });
}
