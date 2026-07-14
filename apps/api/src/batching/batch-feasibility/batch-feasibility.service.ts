import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BatchPreparationService } from '../batch-preparation/batch-preparation.service';
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
  /** Quantité maximale produisible avec les stocks actuels ; `null` si `isFeasible` est `true`. */
  maxFeasibleQuantity: number | null;
}

const ZERO = new Prisma.Decimal(0);

/**
 * Analyse de faisabilité d'un lancement de batch (retour métier de Kevin) : recalcule
 * les besoins réels de la recette pour la quantité planifiée et les compare aux stocks
 * réellement disponibles. Calcul pur en lecture seule (aucune écriture, aucune
 * décrémentation de stock) — réutilisé à la fois par le contrôle bloquant au lancement
 * (`BatchStepsService.advance`) et par l'endpoint de consultation qui alimente le modal
 * frontend. Réutilise `BatchPreparationService`/`computeFifoAllocations` sans les
 * modifier, exactement comme le fait déjà `BatchClosureService` à la clôture.
 */
@Injectable()
export class BatchFeasibilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly batchPreparationService: BatchPreparationService,
  ) {}

  async checkFeasibility(
    siteId: string,
    recipeId: string,
    quantityToProduce: number,
  ): Promise<BatchFeasibilityReport> {
    const ingredients =
      await this.batchPreparationService.computeIngredientQuantities(
        siteId,
        recipeId,
        quantityToProduce,
      );

    const shortages: ComponentShortage[] = [];
    // Quantité maximale produisible = le minimum, sur tous les composants, de
    // (stock disponible ÷ taux de consommation par unité) — voir design validé.
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
      const ratePerUnit = quantityNeeded.dividedBy(quantityToProduce);
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
    return {
      isFeasible,
      requestedQuantity: quantityToProduce,
      shortages,
      maxFeasibleQuantity: isFeasible
        ? null
        : (maxFeasibleQuantity?.toNumber() ?? 0),
    };
  }
}
