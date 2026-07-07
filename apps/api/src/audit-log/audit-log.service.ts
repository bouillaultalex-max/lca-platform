import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditAction, AuditLog, Prisma } from '../../generated/prisma/client';

export interface RecordAuditLogParams {
  userId: string | null;
  action: AuditAction;
  entity: string;
  entityId: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
}

/**
 * Journal technique des écritures sensibles (voir docs/architecture.md et
 * schema.prisma). Premier module à réellement écrire dans `AuditLog` — jusqu'ici
 * défini dans le schéma mais jamais branché (voir Jalon 2.5, gestion des
 * utilisateurs). Limité pour l'instant aux actions de gestion des comptes ; les
 * autres modules ne sont pas rétro-équipés dans ce jalon.
 */
@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  record(params: RecordAuditLogParams): Promise<AuditLog> {
    return this.prisma.auditLog.create({
      data: {
        userId: params.userId,
        action: params.action,
        entity: params.entity,
        entityId: params.entityId,
        before: params.before,
        after: params.after,
      },
    });
  }
}
