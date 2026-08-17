import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { BatchCost, Lot } from '../../../generated/prisma/client';

export type LotBatchCost = BatchCost & { lot: Lot };

/**
 * Consultation en lecture seule du coût figé d'un lot (`BatchCost`, PRD-10, voir
 * ADR 0007). Aucune écriture ici : la création est intégralement gérée par
 * `BatchClosureService`, dans la même transaction que la clôture du batch — ce
 * service ne fait que lire. Pas de `siteId` propre sur `BatchCost` : le cloisonnement
 * par site est appliqué via `lot.siteId` (même convention que `TraceabilityService`).
 */
@Injectable()
export class BatchCostsService {
  constructor(private readonly prisma: PrismaService) {}

  async findByLotId(siteId: string, lotId: string): Promise<LotBatchCost> {
    const batchCost = await this.prisma.batchCost.findFirst({
      where: { lotId, lot: { siteId } },
      include: { lot: true },
    });
    if (!batchCost) {
      throw new NotFoundException(`Coût introuvable pour le lot ${lotId}.`);
    }
    return batchCost;
  }
}
