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
      include: {
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
      },
    });
    if (!lot) {
      throw new NotFoundException(`Lot ${id} introuvable.`);
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
