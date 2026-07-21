import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  BatchPreparationService,
  type IngredientQuantity,
  type MaterialQuantity,
  type PackagingQuantity,
} from '../batch-preparation/batch-preparation.service';
import { computeFifoAllocations } from '../../stock/stock-fifo/stock-fifo.service';
import { Prisma } from '../../../generated/prisma/client';

export interface ComponentShortage {
  articleId: string;
  articleName: string;
  articleReference: string;
  unit: string;
  quantityNeeded: number;
  quantityAvailable: number;
  quantityMissing: number;
}

export interface BatchFeasibilityReport {
  isFeasible: boolean;
  requestedQuantity: number;
  shortages: ComponentShortage[];
  /**
   * Quantité maximale produisible avec les stocks actuels ; `null` si `isFeasible`
   * est `true`, ou si le batch a plusieurs allocations — aucune règle de
   * redimensionnement proportionnel entre allocations n'est définie (décision
   * métier PRD-11) : `shortages` reste alors la seule source de vérité.
   */
  maxFeasibleQuantity: number | null;
}

const ZERO = new Prisma.Decimal(0);

/**
 * Agrège les besoins de packaging de plusieurs allocations par article, pour ne
 * jamais compter deux fois un article de packaging partagé entre deux allocations
 * (voir ADR 0006, PRD-11) — chaque article n'est comparé qu'une seule fois à la
 * somme réelle du besoin, jamais allocation par allocation.
 */
export function aggregatePackagingQuantities(
  perAllocation: PackagingQuantity[][],
): PackagingQuantity[] {
  const totalsByArticleId = new Map<
    string,
    { reference: PackagingQuantity; total: Prisma.Decimal }
  >();

  for (const lines of perAllocation) {
    for (const line of lines) {
      const additional = new Prisma.Decimal(line.quantity);
      const existing = totalsByArticleId.get(line.articleId);
      if (existing) {
        existing.total = existing.total.plus(additional);
      } else {
        totalsByArticleId.set(line.articleId, {
          reference: line,
          total: additional,
        });
      }
    }
  }

  return Array.from(totalsByArticleId.values()).map(({ reference, total }) => ({
    ...reference,
    quantity: total.toNumber(),
  }));
}

/**
 * Analyse de faisabilité d'un lancement de batch (retour métier de Kevin, étendue
 * par PRD-11 aux allocations multi-produits) : recalcule les besoins réels pour la
 * quantité planifiée et les compare aux stocks réellement disponibles. Calcul pur en
 * lecture seule (aucune écriture, aucune décrémentation de stock) — réutilisé à la
 * fois par le contrôle bloquant au lancement (`BatchStepsService.advance`) et par
 * l'endpoint de consultation qui alimente le modal frontend. Réutilise
 * `BatchPreparationService`/`computeFifoAllocations` sans les modifier.
 *
 * Depuis PRD-11 (ADR 0006) : le besoin matière première reste vérifié une seule fois
 * (recette de référence du batch, `Batch.plannedQuantity` — déjà la somme exacte des
 * allocations, jamais recalculée ici) ; le besoin packaging est calculé par
 * allocation (sa propre recette, sa propre quantité) puis agrégé par article avant
 * comparaison au stock. Un batch sans allocation (antérieur à PRD-11, aucun
 * backfill — voir décision 12/13 de l'ADR) conserve exactement le comportement
 * d'avant cette feature.
 */
@Injectable()
export class BatchFeasibilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly batchPreparationService: BatchPreparationService,
  ) {}

  async checkFeasibility(
    siteId: string,
    batchId: string,
  ): Promise<BatchFeasibilityReport> {
    const batch = await this.prisma.batch.findFirst({
      where: { id: batchId, siteId },
      include: { allocations: true },
    });
    if (!batch) {
      throw new NotFoundException(`Batch ${batchId} introuvable.`);
    }

    // Une seule lecture de la recette de référence : réutilisée pour la matière
    // première (toujours) et, en l'absence de toute allocation, pour le packaging
    // (repli sur le comportement antérieur à PRD-11, aucun appel redondant).
    const referenceIngredients =
      await this.batchPreparationService.computeIngredientQuantities(
        siteId,
        batch.recipeId,
        batch.plannedQuantity,
      );
    const materialQuantities = referenceIngredients.filter(
      (ingredient): ingredient is MaterialQuantity =>
        ingredient.kind === 'MATIERE_PREMIERE',
    );

    const packagingQuantities =
      batch.allocations.length === 0
        ? referenceIngredients.filter(
            (ingredient): ingredient is PackagingQuantity =>
              ingredient.kind === 'PACKAGING',
          )
        : aggregatePackagingQuantities(
            await Promise.all(
              batch.allocations.map(async (allocation) =>
                (
                  await this.batchPreparationService.computeIngredientQuantities(
                    siteId,
                    allocation.recipeId,
                    allocation.plannedQuantity,
                  )
                ).filter(
                  (ingredient): ingredient is PackagingQuantity =>
                    ingredient.kind === 'PACKAGING',
                ),
              ),
            ),
          );

    const ingredients: IngredientQuantity[] = [
      ...materialQuantities,
      ...packagingQuantities,
    ];

    const shortages: ComponentShortage[] = [];
    // Quantité maximale produisible = le minimum, sur tous les composants, de
    // (stock disponible ÷ taux de consommation par unité) — voir design validé.
    // Le taux se base sur `Batch.plannedQuantity`, seule quantité de référence
    // commune ; forcée à `null` plus bas si le batch a plusieurs allocations.
    let maxFeasibleQuantity: Prisma.Decimal | null = null;

    for (const ingredient of ingredients) {
      const quantityNeeded = new Prisma.Decimal(
        ingredient.kind === 'MATIERE_PREMIERE'
          ? ingredient.volumeL
          : ingredient.quantity,
      );
      const unit =
        ingredient.kind === 'MATIERE_PREMIERE' ? 'L' : ingredient.unit;

      const lots = await this.prisma.stockLot.findMany({
        where: {
          siteId,
          articleId: ingredient.articleId,
          remainingQuantity: { gt: 0 },
        },
        orderBy: { receivedAt: 'asc' },
      });
      // Somme réelle du stock disponible pour cet article — indépendante du besoin
      // demandé, nécessaire pour calculer la quantité max produisible même quand le
      // composant est déjà suffisant pour la quantité actuellement demandée.
      const quantityAvailable = lots.reduce(
        (sum, lot) => sum.plus(lot.remainingQuantity),
        ZERO,
      );

      const { shortfall } = computeFifoAllocations(lots, quantityNeeded);
      if (shortfall.greaterThan(0)) {
        shortages.push({
          articleId: ingredient.articleId,
          articleName: ingredient.articleName,
          articleReference: ingredient.articleReference,
          unit,
          quantityNeeded: quantityNeeded.toNumber(),
          quantityAvailable: quantityAvailable.toNumber(),
          quantityMissing: shortfall.toNumber(),
        });
      }

      // Taux de consommation par unité produite, dérivé directement du besoin déjà
      // calculé (évite de dupliquer la distinction matière première/packaging).
      const ratePerUnit = quantityNeeded.dividedBy(batch.plannedQuantity);
      if (ratePerUnit.greaterThan(0)) {
        const maxForThisIngredient = Prisma.Decimal.max(
          quantityAvailable.dividedBy(ratePerUnit).floor(),
          ZERO,
        );
        maxFeasibleQuantity =
          maxFeasibleQuantity === null
            ? maxForThisIngredient
            : Prisma.Decimal.min(maxFeasibleQuantity, maxForThisIngredient);
      }
    }

    const isFeasible = shortages.length === 0;
    // Aucune règle de redimensionnement proportionnel entre allocations n'existe
    // (décision métier PRD-11) : au-delà d'une seule allocation, `maxFeasibleQuantity`
    // n'a pas de sens univoque et n'est jamais retourné — `shortages` fait foi seul.
    const hasMultipleAllocations = batch.allocations.length > 1;
    return {
      isFeasible,
      requestedQuantity: batch.plannedQuantity,
      shortages,
      maxFeasibleQuantity:
        !isFeasible && !hasMultipleAllocations
          ? (maxFeasibleQuantity?.toNumber() ?? 0)
          : null,
    };
  }
}
