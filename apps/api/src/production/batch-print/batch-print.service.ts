import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  BatchPreparationService,
  type IngredientQuantity,
} from '../../batching/batch-preparation/batch-preparation.service';
import { BatchStatus } from '../../../generated/prisma/client';

/**
 * Données d'une paire d'étiquettes (PRODUIT + BATCHING) pour une allocation — ou
 * pour le batch entier, `allocationId: null`, dans le seul cas d'un batch
 * historique sans allocation (repli antérieur à PRD-11, ADR 0006 § Conséquences,
 * même convention que `BatchClosureService.buildClosureLines`).
 */
export interface PrintAllocationData {
  allocationId: string | null;
  productName: string;
  /** Quantité prévue à batcher (`plannedQuantity`) — le batch est nécessairement
   * `EN_COURS`, donc pas encore clôturé : `producedQuantity`/`rejectedQuantity`
   * ne sont pas encore connus (voir ADR 0010 § Décision 11 « LOT NUMBER... »). */
  quantityToBatch: number;
  /** Résultat complet de `BatchPreparationService.computeIngredientQuantities`
   * pour cette allocation (matière première ET packaging confondus, PG/VG inclus
   * sans traitement spécial, aucune déduplication) — voir ADR 0010 § Décision 17. */
  ingredients: IngredientQuantity[];
}

export interface BatchPrintData {
  batchId: string;
  /** Toujours `Batch.reservedLotNumber` — jamais `Lot.lotNumber` (le `Lot` réel
   * n'existe pas encore à ce stade, voir ADR 0010 § Décision 11/12). */
  lotNumber: string;
  /** Toujours `Batch.reservedExpiryDate`, jamais recalculée. */
  expiryDate: Date;
  allocations: PrintAllocationData[];
}

/**
 * Données agrégées pour l'impression des étiquettes Brady BBP12 (voir ADR 0010
 * § Décisions 16/17) : une paire d'étiquettes (PRODUIT + BATCHING) par allocation,
 * numéro de lot et DDM communs (`Batch.reservedLotNumber`/`reservedExpiryDate`),
 * produit/quantité/recette propres à chaque allocation. Lecture seule — aucune
 * écriture, réutilisable un nombre quelconque de fois sans effet de bord (aucun
 * appel à `generate()`/`reserveLotNumber()`, jamais de lecture de `Lot`).
 */
@Injectable()
export class BatchPrintService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly batchPreparationService: BatchPreparationService,
  ) {}

  async getPrintData(siteId: string, batchId: string): Promise<BatchPrintData> {
    const batch = await this.prisma.batch.findFirst({
      where: { id: batchId, siteId },
      include: {
        allocations: {
          include: { product: true },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        },
        recipe: { include: { finishedProduct: true } },
      },
    });
    if (!batch) {
      throw new NotFoundException(`Batch ${batchId} introuvable.`);
    }
    if (batch.status !== BatchStatus.EN_COURS) {
      throw new BadRequestException(
        "L'impression des étiquettes n'est disponible que pour un batch en cours.",
      );
    }

    const hasReservedLotNumber = batch.reservedLotNumber !== null;
    const hasReservedExpiryDate = batch.reservedExpiryDate !== null;
    if (hasReservedLotNumber !== hasReservedExpiryDate) {
      // État normalement rendu impossible par le CHECK PostgreSQL de co-nullabilité
      // (ADR 0010 § Décision 2) — défense en profondeur explicite, jamais une
      // impression avec un numéro ou une DDM partiellement manquants.
      throw new BadRequestException(
        'État de réservation incohérent pour ce batch ; contactez un administrateur.',
      );
    }
    if (!hasReservedLotNumber) {
      // Repli legacy (ADR 0010 § Décision 14) : batch EN_COURS antérieur au
      // déploiement, jamais de numéro réservé — l'impression n'a pas de source
      // fiable de numéro/DDM tant que ce batch n'est pas clôturé (repli generate()).
      throw new BadRequestException(
        "Aucun numéro de lot n'est encore réservé pour ce batch — impression indisponible.",
      );
    }

    const allocationSources =
      batch.allocations.length > 0
        ? batch.allocations.map((allocation) => ({
            allocationId: allocation.id as string | null,
            productName: allocation.product.name,
            recipeId: allocation.recipeId,
            quantityToBatch: allocation.plannedQuantity,
          }))
        : [
            {
              allocationId: null as string | null,
              productName: batch.recipe.finishedProduct.name,
              recipeId: batch.recipeId,
              quantityToBatch: batch.plannedQuantity,
            },
          ];

    const allocations: PrintAllocationData[] = await Promise.all(
      allocationSources.map(async (source) => ({
        allocationId: source.allocationId,
        productName: source.productName,
        quantityToBatch: source.quantityToBatch,
        ingredients: await this.batchPreparationService.computeIngredientQuantities(
          siteId,
          source.recipeId,
          source.quantityToBatch,
        ),
      })),
    );

    return {
      batchId: batch.id,
      lotNumber: batch.reservedLotNumber!,
      expiryDate: batch.reservedExpiryDate!,
      allocations,
    };
  }
}
