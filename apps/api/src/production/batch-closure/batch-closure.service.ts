import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  BatchPreparationService,
  type PackagingQuantity,
} from '../../batching/batch-preparation/batch-preparation.service';
import { LotNumberGeneratorService } from '../lot-number-generator/lot-number-generator.service';
import { CloseBatchDto } from './dto/close-batch.dto';
import {
  computeFifoAllocations,
  type FifoAllocation,
} from '../../stock/stock-fifo/stock-fifo.service';
import {
  Batch,
  BatchProductAllocation,
  BatchStatus,
  BatchStep,
  Lot,
  Prisma,
  StockMovementType,
} from '../../../generated/prisma/client';

export interface BatchClosureResult {
  batch: Batch;
  lots: Lot[];
  /**
   * Alias temporaire vers `lots[0]` (voir plan-developpement.md, étapes 10/14 —
   * PRD-11). Conservé uniquement pour ne pas casser immédiatement le frontend actuel
   * (`CloseBatchSection`, qui lit `result.lot.lotNumber`) tant que l'étape 14
   * (clôture par allocation côté frontend) n'est pas livrée. `lots` est la réponse
   * officielle ; `lot` sera retiré une fois le frontend adapté — ne jamais construire
   * de nouvelle logique sur ce champ.
   */
  lot: Lot;
}

/** Représentation interne unique d'une "sortie" à clôturer, qu'elle provienne d'une
 * allocation réelle ou du repli historique (batch sans allocation, voir décision
 * métier PRD-11 du 2026-07-21) — un seul chemin de traitement au-delà de ce point. */
interface ClosureLine {
  allocationId: string | null;
  recipeId: string;
  producedQuantity: number;
  rejectedQuantity: number;
}

const ZERO = new Prisma.Decimal(0);

/**
 * Clôture d'un batch : génère un `Lot` par allocation (ou un lot unique historique
 * pour un batch antérieur à PRD-11, sans allocation), sa généalogie, et déduit le
 * stock consommé (FIFO), le tout dans une seule transaction Prisma (voir
 * docs/regles-metier.md §2-3-12, ADR 0006 PRD-11). Ne modifie rien si le stock est
 * insuffisant pour au moins un composant (aucune écriture partielle).
 *
 * Matière première : commune à tout le batch, calculée et déduite **une seule fois**
 * sur la quantité totale traitée (Σ produite + rebuts de toutes les lignes), puis sa
 * généalogie est répartie entre les lots des lignes éligibles au prorata de leur
 * propre quantité traitée (décision métier PRD-11, reliquat d'arrondi affecté à la
 * dernière ligne éligible dans l'ordre déterministe). Packaging : calculé et déduit
 * **par ligne**, séquentiellement (jamais en parallèle), sa généalogie rattachée
 * directement au lot de cette ligne, sans répartition.
 *
 * Une ligne à quantité traitée nulle (0 produit + 0 rebut) est clôturée (ses quantités
 * sont enregistrées) mais ne génère **aucun** lot, aucune consommation, aucune
 * généalogie — exception volontaire pour préserver l'invariant "tout lot clôturé
 * possède au moins une ligne de généalogie" (voir docs/modele-donnees.md).
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
    this.assertPayloadShapeIsUnambiguous(dto);

    const batch = await this.prisma.batch.findFirst({
      where: { id: batchId, siteId },
      include: { allocations: true },
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

    const closureLines = this.buildClosureLines(batch, dto);
    const totalTreated = closureLines.reduce(
      (sum, line) => sum + line.producedQuantity + line.rejectedQuantity,
      0,
    );
    if (totalTreated <= 0) {
      throw new BadRequestException(
        'La quantité totale (produite + rebuts) doit être positive.',
      );
    }
    // Lignes générant réellement un lot (voir décision métier PRD-11 du 2026-07-21) :
    // une ligne à quantité traitée nulle est clôturée mais ne produit ni lot, ni
    // consommation, ni généalogie.
    const eligibleLines = closureLines.filter(
      (line) => line.producedQuantity + line.rejectedQuantity > 0,
    );

    // Recette/lignes/articles sont immuables une fois créés (toute modification crée une
    // nouvelle version) : cette lecture peut se faire hors transaction sans risque de
    // cohérence, contrairement au stock (StockLot.remainingQuantity), lu plus bas dans
    // la transaction pour un instantané cohérent au moment de la déduction.
    const referenceIngredients =
      await this.batchPreparationService.computeIngredientQuantities(
        siteId,
        batch.recipeId,
        totalTreated,
      );
    const materialNeed = referenceIngredients.filter(
      (ingredient) => ingredient.kind === 'MATIERE_PREMIERE',
    );

    // Une seule lecture de la recette de référence, réutilisée pour le packaging en
    // l'absence de toute allocation (repli historique, aucun appel redondant).
    const packagingNeedByLine = new Map<string | null, PackagingQuantity[]>();
    for (const line of eligibleLines) {
      const treatedQuantity = line.producedQuantity + line.rejectedQuantity;
      const ingredients =
        batch.allocations.length === 0
          ? referenceIngredients
          : await this.batchPreparationService.computeIngredientQuantities(
              siteId,
              line.recipeId,
              treatedQuantity,
            );
      packagingNeedByLine.set(
        line.allocationId,
        ingredients.filter(
          (ingredient): ingredient is PackagingQuantity =>
            ingredient.kind === 'PACKAGING',
        ),
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // Simulation cumulative : deux lignes consommant le même article de packaging
      // doivent voir, la seconde, le stock déjà réduit par la première (voir
      // plan-developpement.md étape 10) — jamais de calcul en parallèle.
      const stockLotsByArticle = new Map<
        string,
        { id: string; remainingQuantity: Prisma.Decimal }[]
      >();
      const plannedByStockLot = new Map<string, Prisma.Decimal>();
      const shortages: string[] = [];

      const planConsumption = async (
        articleId: string,
        articleName: string,
        quantityNeeded: Prisma.Decimal,
      ): Promise<FifoAllocation[] | null> => {
        let lots = stockLotsByArticle.get(articleId);
        if (!lots) {
          lots = await tx.stockLot.findMany({
            where: { siteId, articleId, remainingQuantity: { gt: 0 } },
            orderBy: { receivedAt: 'asc' },
          });
          stockLotsByArticle.set(articleId, lots);
        }
        const adjustedLots = lots
          .map((lot) => ({
            id: lot.id,
            remainingQuantity: lot.remainingQuantity.minus(
              plannedByStockLot.get(lot.id) ?? ZERO,
            ),
          }))
          .filter((lot) => lot.remainingQuantity.greaterThan(0));

        const { allocations, shortfall } = computeFifoAllocations(
          adjustedLots,
          quantityNeeded,
        );
        if (shortfall.greaterThan(0)) {
          shortages.push(`${articleName} (${shortfall.toString()} manquant)`);
          return null;
        }
        for (const allocation of allocations) {
          const already = plannedByStockLot.get(allocation.stockLotId) ?? ZERO;
          plannedByStockLot.set(
            allocation.stockLotId,
            already.plus(allocation.quantityToConsume),
          );
        }
        return allocations;
      };

      // 1. Matière première : une seule fois pour tout le batch.
      const materialConsumptions: {
        articleId: string;
        allocations: FifoAllocation[];
      }[] = [];
      for (const ingredient of materialNeed) {
        const quantityNeeded = new Prisma.Decimal(ingredient.volumeL);
        const allocations = await planConsumption(
          ingredient.articleId,
          ingredient.articleName,
          quantityNeeded,
        );
        if (allocations) {
          materialConsumptions.push({
            articleId: ingredient.articleId,
            allocations,
          });
        }
      }

      // 2. Packaging : par ligne éligible, séquentiellement.
      const packagingConsumptionsByLine = new Map<
        string | null,
        { articleId: string; allocations: FifoAllocation[] }[]
      >();
      for (const line of eligibleLines) {
        const need = packagingNeedByLine.get(line.allocationId) ?? [];
        const consumptions: {
          articleId: string;
          allocations: FifoAllocation[];
        }[] = [];
        for (const ingredient of need) {
          const quantityNeeded = new Prisma.Decimal(ingredient.quantity);
          const allocations = await planConsumption(
            ingredient.articleId,
            ingredient.articleName,
            quantityNeeded,
          );
          if (allocations) {
            consumptions.push({
              articleId: ingredient.articleId,
              allocations,
            });
          }
        }
        packagingConsumptionsByLine.set(line.allocationId, consumptions);
      }

      if (shortages.length > 0) {
        throw new BadRequestException(
          `Stock insuffisant pour clôturer ce batch : ${shortages.join(', ')}.`,
        );
      }

      // 3. Écriture de la consommation matière première (jamais de batchProductAllocationId).
      for (const consumption of materialConsumptions) {
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
              batchProductAllocationId: null,
              userId,
            },
          });
        }
      }

      // 4. Par ligne éligible : lot, packaging (avec batchProductAllocationId) et
      // mise à jour des quantités réelles de l'allocation.
      const endedAt = new Date(dto.endedAt);
      const expiryDateValue = dto.expiryDate ? new Date(dto.expiryDate) : null;
      const lots: Lot[] = [];
      const lotByAllocationId = new Map<string | null, Lot>();

      for (const line of eligibleLines) {
        const lotNumber = await this.lotNumberGeneratorService.generate(
          siteId,
          tx,
        );
        const treatedQuantity = line.producedQuantity + line.rejectedQuantity;

        const lot = await tx.lot.create({
          data: {
            siteId,
            batchId,
            allocationId: line.allocationId,
            lotNumber,
            quantity: treatedQuantity,
            manufacturedAt: endedAt,
            expiryDate: expiryDateValue,
          },
        });
        lots.push(lot);
        lotByAllocationId.set(line.allocationId, lot);

        const packagingConsumptions =
          packagingConsumptionsByLine.get(line.allocationId) ?? [];
        for (const consumption of packagingConsumptions) {
          for (const allocation of consumption.allocations) {
            await tx.stockLot.update({
              where: { id: allocation.stockLotId },
              data: {
                remainingQuantity: {
                  decrement: allocation.quantityToConsume,
                },
              },
            });
            await tx.stockItem.update({
              where: { articleId: consumption.articleId },
              data: {
                availableQuantity: {
                  decrement: allocation.quantityToConsume,
                },
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
                batchProductAllocationId: line.allocationId,
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

        if (line.allocationId) {
          await tx.batchProductAllocation.update({
            where: { id: line.allocationId },
            data: {
              producedQuantity: line.producedQuantity,
              rejectedQuantity: line.rejectedQuantity,
            },
          });
        }
      }

      // Lignes non éligibles (0/0) : l'allocation est tout de même clôturée, sans lot.
      for (const line of closureLines) {
        if (eligibleLines.includes(line)) {
          continue;
        }
        if (line.allocationId) {
          await tx.batchProductAllocation.update({
            where: { id: line.allocationId },
            data: {
              producedQuantity: line.producedQuantity,
              rejectedQuantity: line.rejectedQuantity,
            },
          });
        }
      }

      // 5. Généalogie matière première : répartie entre les lots des lignes éligibles
      // au prorata de leur quantité traitée, reliquat exact affecté à la dernière ligne
      // éligible dans l'ordre déterministe (jamais un nouveau calcul au prorata pour
      // cette dernière ligne).
      const totalTreatedDecimal = new Prisma.Decimal(totalTreated);
      for (const consumption of materialConsumptions) {
        for (const allocation of consumption.allocations) {
          let remaining = allocation.quantityToConsume;
          for (let index = 0; index < eligibleLines.length; index += 1) {
            const line = eligibleLines[index];
            const lot = lotByAllocationId.get(line.allocationId)!;
            const isLast = index === eligibleLines.length - 1;
            const lineTreated = new Prisma.Decimal(
              line.producedQuantity + line.rejectedQuantity,
            );
            const share = isLast
              ? remaining
              : allocation.quantityToConsume
                  .times(lineTreated)
                  .dividedBy(totalTreatedDecimal);
            if (!isLast) {
              remaining = remaining.minus(share);
            }
            if (share.greaterThan(0)) {
              await tx.lotGenealogy.create({
                data: {
                  lotId: lot.id,
                  consumedArticleId: consumption.articleId,
                  consumedStockLotId: allocation.stockLotId,
                  consumedQuantity: share,
                },
              });
            }
          }
        }
      }

      // 6. Agrégats du batch : dérivés par somme des lignes, jamais saisis
      // indépendamment (aucune divergence possible par construction).
      const updatedBatch = await tx.batch.update({
        where: { id: batchId },
        data: {
          producedQuantity: closureLines.reduce(
            (sum, line) => sum + line.producedQuantity,
            0,
          ),
          rejectedQuantity: closureLines.reduce(
            (sum, line) => sum + line.rejectedQuantity,
            0,
          ),
          endedAt,
          formatChanged: dto.formatChanged ?? false,
          formatChangeDetail: dto.formatChangeDetail,
          status: BatchStatus.TERMINE,
        },
      });

      return { batch: updatedBatch, lots, lot: lots[0] };
    });
  }

  /** Refuse un payload fournissant à la fois les champs racine et un tableau
   * `allocations` non vide — indépendant de l'état réel du batch. */
  private assertPayloadShapeIsUnambiguous(dto: CloseBatchDto): void {
    const rootFieldsProvided =
      dto.producedQuantity !== undefined || dto.rejectedQuantity !== undefined;
    const allocationsProvided =
      dto.allocations !== undefined && dto.allocations.length > 0;
    if (rootFieldsProvided && allocationsProvided) {
      throw new BadRequestException(
        'Précisez soit producedQuantity/rejectedQuantity, soit allocations[], jamais les deux.',
      );
    }
  }

  /**
   * Construit la représentation interne unique à partir du DTO, en fonction de la
   * présence ou non d'allocations réelles sur ce batch — trie les lignes dans l'ordre
   * déterministe (createdAt croissant, id en second critère) dans le cas à plusieurs
   * allocations.
   *
   * Compatibilité transitoire (correction du constat d'intégration du 2026-07-21,
   * en attendant l'étape 14 — clôture par allocation côté frontend) : un batch à
   * **exactement une allocation** accepte encore l'ancien format racine
   * (`producedQuantity`/`rejectedQuantity`), en plus du nouveau format
   * `allocations[]` — le frontend actuel n'envoie jamais que l'ancien format, quel
   * que soit le nombre réel d'allocations du batch. Un batch sans allocation
   * (historique) n'accepte que l'ancien format (comportement inchangé) ; un batch à
   * plusieurs allocations n'accepte que le nouveau format (comportement inchangé).
   */
  private buildClosureLines(
    batch: Batch & { allocations: BatchProductAllocation[] },
    dto: CloseBatchDto,
  ): ClosureLine[] {
    if (batch.allocations.length === 0) {
      return [this.buildLineFromRootFields(batch.recipeId, null, dto)];
    }

    const rootFieldsProvided =
      dto.producedQuantity !== undefined && dto.rejectedQuantity !== undefined;
    if (batch.allocations.length === 1 && rootFieldsProvided) {
      const allocation = batch.allocations[0];
      return [
        this.buildLineFromRootFields(allocation.recipeId, allocation.id, dto),
      ];
    }

    if (!dto.allocations || dto.allocations.length === 0) {
      throw new BadRequestException(
        batch.allocations.length === 1
          ? 'Ce batch a une allocation : fournissez producedQuantity/rejectedQuantity, ou le tableau allocations.'
          : 'Ce batch possède des allocations : le tableau allocations est obligatoire.',
      );
    }

    const dtoIds = dto.allocations.map((allocation) => allocation.allocationId);
    if (new Set(dtoIds).size !== dtoIds.length) {
      throw new BadRequestException(
        'Un même allocationId ne peut apparaître qu’une seule fois.',
      );
    }
    const dtoIdSet = new Set(dtoIds);
    const realIds = new Set(
      batch.allocations.map((allocation) => allocation.id),
    );

    const missing = batch.allocations.filter(
      (allocation) => !dtoIdSet.has(allocation.id),
    );
    if (missing.length > 0) {
      throw new BadRequestException(
        `Toutes les allocations du batch doivent être clôturées : allocation(s) manquante(s) (${missing
          .map((allocation) => allocation.id)
          .join(', ')}).`,
      );
    }
    const foreign = dtoIds.filter((id) => !realIds.has(id));
    if (foreign.length > 0) {
      throw new BadRequestException(
        `Un ou plusieurs allocationId ne correspondent à aucune allocation de ce batch (${foreign.join(', ')}).`,
      );
    }

    const orderedAllocations = [...batch.allocations].sort((a, b) => {
      const byCreatedAt = a.createdAt.getTime() - b.createdAt.getTime();
      return byCreatedAt !== 0 ? byCreatedAt : a.id.localeCompare(b.id);
    });

    const dtoByAllocationId = new Map(
      dto.allocations.map((allocation) => [
        allocation.allocationId,
        allocation,
      ]),
    );
    return orderedAllocations.map((allocation) => {
      const line = dtoByAllocationId.get(allocation.id)!;
      return {
        allocationId: allocation.id,
        recipeId: allocation.recipeId,
        producedQuantity: line.producedQuantity,
        rejectedQuantity: line.rejectedQuantity,
      };
    });
  }

  /** Construit une `ClosureLine` à partir des champs racine du DTO (ancien format) —
   * utilisé pour le repli historique (`allocationId: null`) et pour la compatibilité
   * transitoire d'un batch à une seule allocation (`allocationId` renseigné). */
  private buildLineFromRootFields(
    recipeId: string,
    allocationId: string | null,
    dto: CloseBatchDto,
  ): ClosureLine {
    if (
      dto.producedQuantity === undefined ||
      dto.rejectedQuantity === undefined
    ) {
      throw new BadRequestException(
        allocationId === null
          ? 'Ce batch ne possède aucune allocation : producedQuantity et rejectedQuantity sont obligatoires.'
          : 'producedQuantity et rejectedQuantity sont obligatoires pour clôturer avec l’ancien format.',
      );
    }
    return {
      allocationId,
      recipeId,
      producedQuantity: dto.producedQuantity,
      rejectedQuantity: dto.rejectedQuantity,
    };
  }
}
