import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BatchPreparationService } from '../../batching/batch-preparation/batch-preparation.service';
import { LotNumberGeneratorService } from '../lot-number-generator/lot-number-generator.service';
import { CloseBatchDto } from './dto/close-batch.dto';
import {
  computeFifoAllocations,
  type FifoAllocation,
} from '../../stock/stock-fifo/stock-fifo.service';
import {
  Batch,
  BatchStatus,
  BatchStep,
  Lot,
  Prisma,
  StockMovementType,
} from '../../../generated/prisma/client';

export interface BatchClosureResult {
  batch: Batch;
  lot: Lot;
}

/**
 * Clôture d'un batch : génère le `Lot`, sa généalogie (`LotGenealogy`) et déduit le
 * stock consommé (FIFO), le tout dans une seule transaction Prisma (voir
 * docs/regles-metier.md §2-3-12). Ne modifie rien si le stock est insuffisant pour
 * au moins un ingrédient (aucune écriture partielle).
 */
@Injectable()
export class BatchClosureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly batchPreparationService: BatchPreparationService,
    private readonly lotNumberGeneratorService: LotNumberGeneratorService,
  ) {}

  async close(
    siteId: string,
    userId: string,
    batchId: string,
    dto: CloseBatchDto,
  ): Promise<BatchClosureResult> {
    const batch = await this.prisma.batch.findFirst({
      where: { id: batchId, siteId },
    });
    if (!batch) {
      throw new NotFoundException(`Batch ${batchId} introuvable.`);
    }
    if (batch.status !== BatchStatus.EN_COURS) {
      throw new BadRequestException(
        'Seul un batch en cours peut être clôturé.',
      );
    }
    if (batch.currentStep !== BatchStep.CONDITIONNEMENT) {
      throw new BadRequestException(
        'Le batch doit avoir atteint l’étape conditionnement avant de pouvoir être clôturé.',
      );
    }
    const openStop = await this.prisma.batchStop.findFirst({
      where: { batchId, endedAt: null },
    });
    if (openStop) {
      throw new BadRequestException(
        'Un arrêt est encore ouvert pour ce batch ; clôturez-le avant de clôturer le batch.',
      );
    }

    const totalQuantity = dto.producedQuantity + dto.rejectedQuantity;
    if (totalQuantity <= 0) {
      throw new BadRequestException(
        'La quantité totale (produite + rebuts) doit être positive.',
      );
    }

    // Recette/lignes/articles sont immuables une fois créés (toute modification crée une
    // nouvelle version) : cette lecture peut se faire hors transaction sans risque de
    // cohérence, contrairement au stock (StockLot.remainingQuantity), lu plus bas dans
    // la transaction pour un instantané cohérent au moment de la déduction.
    const ingredientQuantities =
      await this.batchPreparationService.computeIngredientQuantities(
        siteId,
        batch.recipeId,
        totalQuantity,
      );

    return this.prisma.$transaction(async (tx) => {
      const shortages: string[] = [];
      const plannedConsumptions: Array<{
        articleId: string;
        allocations: FifoAllocation[];
      }> = [];

      for (const ingredient of ingredientQuantities) {
        const quantityNeeded = new Prisma.Decimal(
          ingredient.kind === 'MATIERE_PREMIERE'
            ? ingredient.volumeL
            : ingredient.quantity,
        );

        const lots = await tx.stockLot.findMany({
          where: {
            siteId,
            articleId: ingredient.articleId,
            remainingQuantity: { gt: 0 },
          },
          orderBy: { receivedAt: 'asc' },
        });
        const { allocations, shortfall } = computeFifoAllocations(
          lots,
          quantityNeeded,
        );

        if (shortfall.greaterThan(0)) {
          shortages.push(
            `${ingredient.articleName} (${shortfall.toString()} manquant)`,
          );
        } else {
          plannedConsumptions.push({
            articleId: ingredient.articleId,
            allocations,
          });
        }
      }

      if (shortages.length > 0) {
        throw new BadRequestException(
          `Stock insuffisant pour clôturer ce batch : ${shortages.join(', ')}.`,
        );
      }

      const lotNumber = await this.lotNumberGeneratorService.generate(
        siteId,
        tx,
      );
      const endedAt = new Date(dto.endedAt);

      const lot = await tx.lot.create({
        data: {
          siteId,
          batchId,
          lotNumber,
          quantity: totalQuantity,
          manufacturedAt: endedAt,
          expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
        },
      });

      for (const consumption of plannedConsumptions) {
        for (const allocation of consumption.allocations) {
          await tx.stockLot.update({
            where: { id: allocation.stockLotId },
            data: {
              remainingQuantity: { decrement: allocation.quantityToConsume },
            },
          });
          await tx.stockItem.update({
            where: { articleId: consumption.articleId },
            data: {
              availableQuantity: { decrement: allocation.quantityToConsume },
            },
          });
          await tx.stockMovement.create({
            data: {
              siteId,
              articleId: consumption.articleId,
              stockLotId: allocation.stockLotId,
              type: StockMovementType.SORTIE_BATCH,
              quantity: allocation.quantityToConsume,
              batchId,
              userId,
            },
          });
          await tx.lotGenealogy.create({
            data: {
              lotId: lot.id,
              consumedArticleId: consumption.articleId,
              consumedStockLotId: allocation.stockLotId,
              consumedQuantity: allocation.quantityToConsume,
            },
          });
        }
      }

      const updatedBatch = await tx.batch.update({
        where: { id: batchId },
        data: {
          producedQuantity: dto.producedQuantity,
          rejectedQuantity: dto.rejectedQuantity,
          endedAt,
          formatChanged: dto.formatChanged ?? false,
          formatChangeDetail: dto.formatChangeDetail,
          status: BatchStatus.TERMINE,
        },
      });

      return { batch: updatedBatch, lot };
    });
  }
}
