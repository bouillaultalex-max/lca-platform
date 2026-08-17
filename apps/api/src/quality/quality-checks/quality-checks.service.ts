import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { CreateQualityCheckDto } from './dto/create-quality-check.dto';
import { computeLotQualityStatus } from '../lot-quality-status/lot-quality-status-calculation';
import { Lot, QualityCheck } from '../../../generated/prisma/client';

export type LotWithQualityChecks = Lot & { qualityChecks: QualityCheck[] };

/**
 * QUA-01/QUA-03 (voir ADR 0008). Consultation en lecture seule
 * (`findByLotId`) et création (`create`) d'un `QualityCheck` — jamais de
 * modification ni de suppression : immuable en V1. La création du
 * `QualityCheck` et le recalcul de `Lot.qualityStatus` sont atomiques (même
 * transaction Prisma) ; l'entrée `AuditLog` est journalisée après le succès de
 * la transaction, même convention que `UserAdminService` (seul autre module à
 * écrire dans `AuditLog` à ce jour) — l'atomicité requise par ADR 0008 porte
 * sur `QualityCheck` + `Lot.qualityStatus`, pas sur l'entrée d'audit.
 */
@Injectable()
export class QualityChecksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async findByLotId(
    siteId: string,
    lotId: string,
  ): Promise<LotWithQualityChecks> {
    const lot = await this.prisma.lot.findFirst({
      where: { id: lotId, siteId },
      include: { qualityChecks: { orderBy: { checkedAt: 'asc' } } },
    });
    if (!lot) {
      throw new NotFoundException(`Lot ${lotId} introuvable.`);
    }
    return lot;
  }

  async create(
    siteId: string,
    userId: string,
    lotId: string,
    dto: CreateQualityCheckDto,
  ): Promise<QualityCheck> {
    const lot = await this.prisma.lot.findFirst({
      where: { id: lotId, siteId },
    });
    if (!lot) {
      throw new NotFoundException(`Lot ${lotId} introuvable.`);
    }

    const qualityCheck = await this.prisma.$transaction(async (tx) => {
      const created = await tx.qualityCheck.create({
        data: {
          lotId,
          type: dto.type,
          result: dto.result,
          controllerId: userId,
          checkedAt: dto.checkedAt ? new Date(dto.checkedAt) : new Date(),
          comment: dto.comment,
        },
      });

      // Relit l'ensemble des contrôles du lot (celui qui vient d'être créé
      // inclus) pour un recalcul déterministe, indépendant de l'état en mémoire.
      const allChecks = await tx.qualityCheck.findMany({
        where: { lotId },
        select: { result: true },
      });
      const qualityStatus = computeLotQualityStatus(
        allChecks.map((check) => check.result),
      );
      await tx.lot.update({
        where: { id: lotId },
        data: { qualityStatus },
      });

      return created;
    });

    await this.auditLogService.record({
      userId,
      action: 'CREATE',
      entity: 'QualityCheck',
      entityId: qualityCheck.id,
      after: {
        lotId: qualityCheck.lotId,
        type: qualityCheck.type,
        result: qualityCheck.result,
        controllerId: qualityCheck.controllerId,
        checkedAt: qualityCheck.checkedAt.toISOString(),
        comment: qualityCheck.comment,
      },
    });

    return qualityCheck;
  }
}
