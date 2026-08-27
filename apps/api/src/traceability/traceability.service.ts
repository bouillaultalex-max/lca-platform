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
   * Même généalogie complète, retrouvée par numéro de lot métier (ex. 455149)
   * plutôt que par identifiant technique — voir TRAC-03A. `lotNumber` n'est plus
   * unique globalement depuis ADR 0010 (§ Décision 4/15) : plusieurs `Lot` d'un
   * même `Batch` multi-allocation peuvent partager le même numéro. Retourne donc
   * systématiquement une **liste**, jamais un objet unique — y compris à taille 0
   * (aucune correspondance, `200` + `[]`, jamais `404`) ou 1 (cas mono-allocation,
   * majoritaire, toujours représenté comme une liste à un élément). `siteId` reste
   * dans le `where` pour ne jamais permettre de retrouver un lot d'un autre site
   * par ce biais. Ordre par `createdAt` croissant : aucun ordre métier n'est requis
   * par l'ADR, seule la stabilité du résultat entre deux appels identiques compte.
   */
  async findLotTraceabilityByNumber(
    siteId: string,
    lotNumber: string,
  ): Promise<LotTraceability[]> {
    return this.prisma.lot.findMany({
      where: { lotNumber, siteId },
      include: LOT_TRACEABILITY_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
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
