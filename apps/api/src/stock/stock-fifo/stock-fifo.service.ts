import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';

export interface FifoAllocation {
  stockLotId: string;
  quantityToConsume: Prisma.Decimal;
}

export interface FifoAllocationResult {
  allocations: FifoAllocation[];
  /** Quantité non couverte par le stock disponible ; `0` si entièrement couverte. */
  shortfall: Prisma.Decimal;
}

interface StockLotForAllocation {
  id: string;
  remainingQuantity: Prisma.Decimal;
}

/**
 * Logique pure de sélection FIFO (aucun accès base) : à partir d'une liste de lots
 * déjà chargée (triée du plus ancien au plus récent) et d'une quantité nécessaire,
 * retourne le plan de consommation ainsi que l'éventuel manquant. Séparée de
 * `StockFifoService.allocate()` pour être réutilisable à l'intérieur d'une transaction
 * Prisma (ex : clôture de batch, module `production`) sans dupliquer l'algorithme.
 */
export function computeFifoAllocations(
  lots: StockLotForAllocation[],
  quantityNeeded: Prisma.Decimal,
): FifoAllocationResult {
  const allocations: FifoAllocation[] = [];
  let remaining = quantityNeeded;

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

  return {
    allocations,
    shortfall: remaining.greaterThan(0) ? remaining : new Prisma.Decimal(0),
  };
}

/**
 * Sélection FIFO des `StockLot` à consommer pour une quantité donnée d'un article :
 * le lot reçu le plus anciennement est consommé en premier (voir docs/regles-metier.md
 * §3). Service pur en dehors de la lecture (aucune écriture) : la déduction effective
 * du stock (module `production`, clôture de batch) appelle `computeFifoAllocations`
 * directement à l'intérieur de sa propre transaction, pour un instantané cohérent.
 */
@Injectable()
export class StockFifoService {
  constructor(private readonly prisma: PrismaService) {}

  async allocate(
    siteId: string,
    articleId: string,
    quantityNeeded: number | Prisma.Decimal,
  ): Promise<FifoAllocation[]> {
    const remaining = new Prisma.Decimal(quantityNeeded);
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

    const { allocations, shortfall } = computeFifoAllocations(lots, remaining);

    if (shortfall.greaterThan(0)) {
      throw new BadRequestException(
        `Stock insuffisant pour l'article ${articleId} : ${shortfall.toString()} unité(s) manquante(s).`,
      );
    }

    return allocations;
  }
}
