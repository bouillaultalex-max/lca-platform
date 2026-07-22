/** Ligne de clôture saisie pour une allocation précise, avant envoi au backend. */
export interface AllocationClosureInput {
  allocationId: string;
  plannedQuantity: number;
  producedQuantity: number;
  rejectedQuantity: number;
}

export interface AllocationClosureValidationError {
  allocationId: string;
  message: string;
}

/**
 * Valide chaque ligne de clôture par allocation avant envoi (voir ProductionPage,
 * CloseBatchSection) : conforme et rebuts doivent être des entiers positifs ou nuls,
 * et leur somme doit être rigoureusement égale à la quantité prévue de l'allocation
 * — volontairement aucun recalcul ni ajustement automatique, l'utilisateur doit
 * corriger lui-même la ligne signalée. Ne valide rien sur le cas historique (batch
 * sans allocation), qui conserve l'ancien formulaire sans cette contrainte.
 */
export function validateAllocationClosureLines(
  lines: AllocationClosureInput[],
): AllocationClosureValidationError[] {
  const errors: AllocationClosureValidationError[] = [];
  for (const line of lines) {
    if (!Number.isInteger(line.producedQuantity) || line.producedQuantity < 0) {
      errors.push({
        allocationId: line.allocationId,
        message: 'La quantité conforme doit être un entier positif ou nul.',
      });
      continue;
    }
    if (!Number.isInteger(line.rejectedQuantity) || line.rejectedQuantity < 0) {
      errors.push({
        allocationId: line.allocationId,
        message: 'Les rebuts doivent être un entier positif ou nul.',
      });
      continue;
    }
    const total = line.producedQuantity + line.rejectedQuantity;
    if (total !== line.plannedQuantity) {
      errors.push({
        allocationId: line.allocationId,
        message: `Le total conforme + rebuts (${total}) doit être égal à la quantité prévue (${line.plannedQuantity}).`,
      });
    }
  }
  return errors;
}
