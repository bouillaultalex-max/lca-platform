import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StockMovement } from '../../../generated/prisma/client';

@Injectable()
export class StockMovementsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Historique des mouvements d'un lot précis, du plus récent au plus ancien. */
  findAllByStockLot(
    siteId: string,
    stockLotId: string,
  ): Promise<StockMovement[]> {
    return this.prisma.stockMovement.findMany({
      where: { siteId, stockLotId },
      orderBy: { movementDate: 'desc' },
    });
  }
}
