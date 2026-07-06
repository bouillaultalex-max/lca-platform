import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';

export interface FifoAllocation {
  stockLotId: string;
  quantityToConsume: Prisma.Decimal;
}

/**
 * Sélection FIFO des `StockLot` à consommer pour une quantité donnée d'un article :
 * le lot reçu le plus anciennement est consommé en premier (voir docs/regles-metier.md
 * §3). Service pur (aucune écriture) : la déduction effective du stock (module
 * `production`, Jalon 2/3) appellera ce service puis appliquera le plan retourné.
 */
@Injectable()
export class StockFifoService {
  constructor(private readonly prisma: PrismaService) {}

  async allocate(
    siteId: string,
    articleId: string,
    quantityNeeded: number | Prisma.Decimal,
  ): Promise<FifoAllocation[]> {
    let remaining = new Prisma.Decimal(quantityNeeded);
    if (remaining.lessThanOrEqualTo(0)) {
      throw new BadRequestException(
        'La quantité à consommer doit être positive.',
      );
    }

    // Ignore explicitement les lots à quantité disponible nulle (filtre en base).
    const lots = await this.prisma.stockLot.findMany({
      where: { siteId, articleId, remainingQuantity: { gt: 0 } },
      orderBy: { receivedAt: 'asc' },
    });

    const allocations: FifoAllocation[] = [];

    for (const lot of lots) {
      if (remaining.lessThanOrEqualTo(0)) {
        break;
      }
      const quantityToConsume = Prisma.Decimal.min(
        lot.remainingQuantity,
        remaining,
      );
      allocations.push({ stockLotId: lot.id, quantityToConsume });
      remaining = remaining.minus(quantityToConsume);
    }

    if (remaining.greaterThan(0)) {
      throw new BadRequestException(
        `Stock insuffisant pour l'article ${articleId} : ${remaining.toString()} unité(s) manquante(s).`,
      );
    }

    return allocations;
  }
}
