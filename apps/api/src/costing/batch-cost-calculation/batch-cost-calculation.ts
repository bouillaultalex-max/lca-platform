import { Prisma } from '../../../generated/prisma/client';

/** Une ligne de consommation déjà valorisée : quantité consommée (matière première
 * ou packaging) et coût unitaire de l'article au moment de la clôture
 * (`Article.currentUnitCost` — jamais un coût pondéré par `StockLot`/FIFO, voir ADR
 * 0007). Le FIFO a déjà déterminé la quantité ; cette fonction ne fait que valoriser. */
export interface CostedConsumptionLine {
  quantity: Prisma.Decimal;
  unitCost: Prisma.Decimal;
}

export interface BatchCostCalculationInput {
  materialConsumptions: CostedConsumptionLine[];
  packagingConsumptions: CostedConsumptionLine[];
  /** Quantité totale traitée du lot (conforme + rebuts) — dénominateur de
   * `unitCostPerFlacon` (docs/regles-metier.md §5, ADR 0007). Doit être strictement
   * positive : `BatchClosureService` ne génère un lot que pour une ligne dont la
   * quantité traitée est positive (voir invariant `eligibleLines`). */
  producedQuantityTotal: Prisma.Decimal;
}

export interface BatchCostCalculationResult {
  materialCostTotal: Prisma.Decimal;
  packagingCostTotal: Prisma.Decimal;
  totalCost: Prisma.Decimal;
  unitCostPerFlacon: Prisma.Decimal;
}

const sumCost = (lines: CostedConsumptionLine[]): Prisma.Decimal =>
  lines.reduce(
    (sum, line) => sum.plus(line.quantity.times(line.unitCost)),
    new Prisma.Decimal(0),
  );

/**
 * Calcul pur (aucun accès base) du coût figé d'un lot à la clôture : matière première
 * + packaging, valorisés à `Article.currentUnitCost` (voir ADR 0007 — le FIFO
 * détermine les quantités/lots réellement consommés en amont, jamais le prix). Le
 * coût unitaire par flacon divise le coût total par la quantité totale **traitée**
 * du lot (conforme + rebuts), pas la seule quantité conforme — cohérent avec
 * `docs/regles-metier.md` §5 et `Lot.quantity`. Séparée de `BatchClosureService` pour
 * rester déterministe et facilement testable, sans dupliquer la logique FIFO déjà
 * calculée en amont (voir `computeFifoAllocations`, module `stock`).
 */
export function computeBatchCost(
  input: BatchCostCalculationInput,
): BatchCostCalculationResult {
  if (input.producedQuantityTotal.lessThanOrEqualTo(0)) {
    throw new Error(
      'producedQuantityTotal doit être strictement positif pour calculer un coût unitaire par flacon.',
    );
  }

  const materialCostTotal = sumCost(input.materialConsumptions);
  const packagingCostTotal = sumCost(input.packagingConsumptions);
  const totalCost = materialCostTotal.plus(packagingCostTotal);
  const unitCostPerFlacon = totalCost.dividedBy(input.producedQuantityTotal);

  return { materialCostTotal, packagingCostTotal, totalCost, unitCostPerFlacon };
}
