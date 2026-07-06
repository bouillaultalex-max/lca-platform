import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  Article,
  ArticleType,
  Prisma,
  StockItem,
} from '../../../generated/prisma/client';

export interface CartonEquivalent {
  fullCartons: number;
  remainderUnits: number;
}

export type StockItemWithCartons = StockItem & {
  article: Article;
  /** Calcul d'affichage uniquement (voir Article.unitsPerCarton) ; le stock reste compté en unités. */
  cartonEquivalent: CartonEquivalent | null;
  /** `null` si aucun seuil n'est défini (pas de statut affichable) ; sinon `availableQuantity <= minimumThreshold`. */
  isLowStock: boolean | null;
};

function computeCartonEquivalent(
  quantity: Prisma.Decimal,
  unitsPerCarton: number | null,
): CartonEquivalent | null {
  if (unitsPerCarton === null) {
    return null;
  }
  return {
    fullCartons: quantity.dividedToIntegerBy(unitsPerCarton).toNumber(),
    remainderUnits: quantity.modulo(unitsPerCarton).toNumber(),
  };
}

function computeIsLowStock(
  availableQuantity: Prisma.Decimal,
  minimumThreshold: Prisma.Decimal | null,
): boolean | null {
  if (minimumThreshold === null) {
    return null;
  }
  return availableQuantity.lessThanOrEqualTo(minimumThreshold);
}

@Injectable()
export class StockItemsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    siteId: string,
    type?: ArticleType,
  ): Promise<StockItemWithCartons[]> {
    const items = await this.prisma.stockItem.findMany({
      where: { siteId, ...(type ? { article: { type } } : {}) },
      include: { article: true },
      orderBy: { article: { name: 'asc' } },
    });
    return items.map((item) => ({
      ...item,
      cartonEquivalent: computeCartonEquivalent(
        item.availableQuantity,
        item.article.unitsPerCarton,
      ),
      isLowStock: computeIsLowStock(
        item.availableQuantity,
        item.minimumThreshold,
      ),
    }));
  }

  async findOne(
    siteId: string,
    articleId: string,
  ): Promise<StockItemWithCartons> {
    const item = await this.prisma.stockItem.findFirst({
      where: { siteId, articleId },
      include: { article: true },
    });
    if (!item) {
      throw new NotFoundException(
        `Aucun stock enregistré pour l'article ${articleId}.`,
      );
    }
    return {
      ...item,
      cartonEquivalent: computeCartonEquivalent(
        item.availableQuantity,
        item.article.unitsPerCarton,
      ),
      isLowStock: computeIsLowStock(
        item.availableQuantity,
        item.minimumThreshold,
      ),
    };
  }

  /**
   * Définit/modifie le seuil de stock minimum d'un article. Nécessite que le
   * `StockItem` existe déjà (donc que l'article ait déjà reçu du stock au moins
   * une fois) — cohérent avec la décision de ne pas créer de `StockItem` "à vide".
   */
  async setMinimumThreshold(
    siteId: string,
    articleId: string,
    minimumThreshold: number,
  ): Promise<StockItemWithCartons> {
    const item = await this.prisma.stockItem.findFirst({
      where: { siteId, articleId },
    });
    if (!item) {
      throw new NotFoundException(
        `Aucun stock enregistré pour l'article ${articleId} : impossible de définir un seuil avant une première réception.`,
      );
    }

    const updated = await this.prisma.stockItem.update({
      where: { articleId },
      data: { minimumThreshold },
      include: { article: true },
    });

    return {
      ...updated,
      cartonEquivalent: computeCartonEquivalent(
        updated.availableQuantity,
        updated.article.unitsPerCarton,
      ),
      isLowStock: computeIsLowStock(
        updated.availableQuantity,
        updated.minimumThreshold,
      ),
    };
  }
}
