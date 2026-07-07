import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateStockLotDto } from './dto/create-stock-lot.dto';
import { AdjustStockLotDto } from './dto/adjust-stock-lot.dto';
import {
  Prisma,
  PrismaClient,
  StockLot,
  StockMovementType,
} from '../../../generated/prisma/client';

/**
 * Surface Prisma minimale nécessaire à `receive()` — satisfaite aussi bien par
 * `PrismaService` que par le client `tx` d'une transaction englobante (même principe
 * que `LotNumberGeneratorService`), pour que de futurs traitements de masse (imports,
 * connecteurs...) puissent réutiliser `receive()` dans leur propre transaction.
 */
export interface StockLotWriteClient {
  article: { findFirst: PrismaClient['article']['findFirst'] };
  stockLot: { create: PrismaClient['stockLot']['create'] };
  stockMovement: { create: PrismaClient['stockMovement']['create'] };
  stockItem: { upsert: PrismaClient['stockItem']['upsert'] };
}

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
   *
   * Accepte un client transactionnel optionnel (`tx` d'une transaction englobante) :
   * si fourni, `receive()` ne rouvre pas sa propre transaction et écrit directement
   * avec ce client, pour permettre à un appelant (ex: import de masse) d'englober
   * plusieurs réceptions dans une seule transaction atomique. Sans client fourni,
   * le comportement est inchangé : `receive()` ouvre et gère sa propre transaction.
   */
  async receive(
    siteId: string,
    userId: string,
    dto: CreateStockLotDto,
    client: StockLotWriteClient = this.prisma,
  ): Promise<StockLot> {
    const article = await client.article.findFirst({
      where: { id: dto.articleId, siteId },
    });
    if (!article) {
      throw new NotFoundException(`Article ${dto.articleId} introuvable.`);
    }

    if (client === this.prisma) {
      return this.prisma.$transaction((tx) =>
        this.writeStockLot(tx, siteId, userId, dto),
      );
    }
    return this.writeStockLot(client, siteId, userId, dto);
  }

  private async writeStockLot(
    client: StockLotWriteClient,
    siteId: string,
    userId: string,
    dto: CreateStockLotDto,
  ): Promise<StockLot> {
    const stockLot = await client.stockLot.create({
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

    await client.stockMovement.create({
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

    await client.stockItem.upsert({
      where: { articleId: dto.articleId },
      update: { availableQuantity: { increment: dto.receivedQuantity } },
      create: {
        siteId,
        articleId: dto.articleId,
        availableQuantity: dto.receivedQuantity,
      },
    });

    return stockLot;
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
