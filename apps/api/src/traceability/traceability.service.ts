import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  Article,
  Batch,
  Lot,
  LotGenealogy,
  Recipe,
  StockLot,
} from '../../generated/prisma/client';

type RecipeWithFinishedProduct = Recipe & { finishedProduct: Article };
type BatchWithRecipe = Batch & { recipe: RecipeWithFinishedProduct };
type GenealogyLineWithRelations = LotGenealogy & {
  consumedArticle: Article;
  consumedStockLot: StockLot;
};

export type LotTraceability = Lot & {
  batch: BatchWithRecipe;
  genealogyLines: GenealogyLineWithRelations[];
};

type LotWithBatch = Lot & { batch: BatchWithRecipe };
type GenealogyLineWithLot = LotGenealogy & { lot: LotWithBatch };

export type StockLotTraceability = StockLot & {
  genealogyLines: GenealogyLineWithLot[];
};

// Partagé entre la recherche par identifiant technique et par numéro de lot :
// même généalogie complète renvoyée dans les deux cas, un seul endroit à faire
// évoluer si les relations incluses changent.
const LOT_TRACEABILITY_INCLUDE = {
  batch: {
    include: {
      recipe: {
        include: { finishedProduct: true },
      },
    },
  },
  genealogyLines: {
    include: {
      consumedArticle: true,
      consumedStockLot: true,
    },
  },
} as const;

@Injectable()
export class TraceabilityService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Généalogie complète d'un lot fini (voir docs/regles-metier.md §2) : batch,
   * recette, produit fini et toutes les lignes de généalogie (article + StockLot
   * consommés, avec le supplierLotNumber déjà porté par StockLot — aucune duplication).
   */
  async findLotTraceability(
    siteId: string,
    id: string,
  ): Promise<LotTraceability> {
    const lot = await this.prisma.lot.findFirst({
      where: { id, siteId },
      include: LOT_TRACEABILITY_INCLUDE,
    });
    if (!lot) {
      throw new NotFoundException(`Lot ${id} introuvable.`);
    }
    return lot;
  }

  /**
   * Même généalogie complète, retrouvée par numéro de lot métier (ex. 455123)
   * plutôt que par identifiant technique — voir TRAC-03A. `lotNumber` est unique
   * globalement (voir schema.prisma), mais `siteId` reste dans le `where` pour
   * ne jamais permettre de retrouver un lot d'un autre site par ce biais.
   */
  async findLotTraceabilityByNumber(
    siteId: string,
    lotNumber: string,
  ): Promise<LotTraceability> {
    const lot = await this.prisma.lot.findFirst({
      where: { lotNumber, siteId },
      include: LOT_TRACEABILITY_INCLUDE,
    });
    if (!lot) {
      throw new NotFoundException(`Lot ${lotNumber} introuvable.`);
    }
    return lot;
  }

  /**
   * Traçabilité inverse d'un StockLot (lot fournisseur) : tous les lots de production
   * qui l'ont consommé, avec pour chacun son batch, sa recette et son produit fini
   * (voir docs/regles-metier.md §2 — capacité de rappel produit dans les deux sens).
   */
  async findStockLotTraceability(
    siteId: string,
    id: string,
  ): Promise<StockLotTraceability> {
    const stockLot = await this.prisma.stockLot.findFirst({
      where: { id, siteId },
      include: {
        genealogyLines: {
          include: {
            lot: {
              include: {
                batch: {
                  include: {
                    recipe: {
                      include: { finishedProduct: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!stockLot) {
      throw new NotFoundException(`StockLot ${id} introuvable.`);
    }
    return stockLot;
  }
}
