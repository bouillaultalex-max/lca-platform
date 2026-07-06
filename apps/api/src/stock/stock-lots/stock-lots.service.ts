import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateStockLotDto } from './dto/create-stock-lot.dto';
import { AdjustStockLotDto } from './dto/adjust-stock-lot.dto';
import {
  Prisma,
  StockLot,
  StockMovementType,
} from '../../../generated/prisma/client';

@Injectable()
export class StockLotsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Détail des lots de réception d'un article, du plus ancien reçu au plus récent
   * (même ordre que la sélection FIFO) — condition nécessaire à la traçabilité
   * amont (voir docs/regles-metier.md §3).
   */
  findAllByArticle(siteId: string, articleId: string): Promise<StockLot[]> {
    return this.prisma.stockLot.findMany({
      where: { siteId, articleId },
      orderBy: { receivedAt: 'asc' },
    });
  }

  /**
   * Réception d'un lot physique : crée le `StockLot`, le `StockMovement` ENTREE
   * associé, et incrémente (ou initialise) `StockItem.availableQuantity` — le tout
   * dans une même transaction (voir docs/modele-donnees.md §3).
   */
  async receive(
    siteId: string,
    userId: string,
    dto: CreateStockLotDto,
  ): Promise<StockLot> {
    const article = await this.prisma.article.findFirst({
      where: { id: dto.articleId, siteId },
    });
    if (!article) {
      throw new NotFoundException(`Article ${dto.articleId} introuvable.`);
    }

    return this.prisma.$transaction(async (tx) => {
      const stockLot = await tx.stockLot.create({
        data: {
          siteId,
          articleId: dto.articleId,
          supplierLotNumber: dto.supplierLotNumber,
          receivedQuantity: dto.receivedQuantity,
          remainingQuantity: dto.receivedQuantity,
          receivedAt: new Date(dto.receivedAt),
          expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
        },
      });

      await tx.stockMovement.create({
        data: {
          siteId,
          articleId: dto.articleId,
          stockLotId: stockLot.id,
          type: StockMovementType.ENTREE,
          quantity: dto.receivedQuantity,
          userId,
          comment: dto.comment,
        },
      });

      await tx.stockItem.upsert({
        where: { articleId: dto.articleId },
        update: { availableQuantity: { increment: dto.receivedQuantity } },
        create: {
          siteId,
          articleId: dto.articleId,
          availableQuantity: dto.receivedQuantity,
        },
      });

      return stockLot;
    });
  }

  /**
   * Ajustement d'inventaire sur un StockLot précis (le lot physiquement recompté).
   * Toujours saisi comme un `StockMovement` (jamais une correction silencieuse) et
   * propage le même delta à `StockItem.availableQuantity`, pour préserver l'invariant
   * StockItem.availableQuantity = somme des StockLot.remainingQuantity de l'article
   * (voir docs/regles-metier.md §3).
   */
  async adjust(
    siteId: string,
    userId: string,
    stockLotId: string,
    dto: AdjustStockLotDto,
  ): Promise<StockLot> {
    const stockLot = await this.prisma.stockLot.findFirst({
      where: { id: stockLotId, siteId },
    });
    if (!stockLot) {
      throw new NotFoundException(`Lot de stock ${stockLotId} introuvable.`);
    }

    const delta = new Prisma.Decimal(dto.countedQuantity).minus(
      stockLot.remainingQuantity,
    );

    return this.prisma.$transaction(async (tx) => {
      const updatedStockLot = await tx.stockLot.update({
        where: { id: stockLotId },
        data: { remainingQuantity: dto.countedQuantity },
      });

      await tx.stockMovement.create({
        data: {
          siteId,
          articleId: stockLot.articleId,
          stockLotId,
          type: StockMovementType.AJUSTEMENT_INVENTAIRE,
          quantity: delta,
          userId,
          comment: dto.comment,
        },
      });

      await tx.stockItem.upsert({
        where: { articleId: stockLot.articleId },
        update: { availableQuantity: { increment: delta } },
        create: {
          siteId,
          articleId: stockLot.articleId,
          availableQuantity: delta,
        },
      });

      return updatedStockLot;
    });
  }
}
