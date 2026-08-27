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

  /**
   * @param tx Client Prisma transactionnel de l'appelant (voir ADR 0010 § Décision
   *   13) — l'écriture d'audit doit rollback avec la mutation métier qu'elle
   *   accompagne, jamais laisser d'entrée orpheline. Par défaut `this.prisma`,
   *   inchangé pour tout appelant existant hors transaction.
   */
  record(
    params: RecordAuditLogParams,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<AuditLog> {
    return tx.auditLog.create({
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
