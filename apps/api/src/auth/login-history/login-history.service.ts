import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LoginHistory } from '../../../generated/prisma/client';

export interface RecordLoginAttemptParams {
  userId: string | null;
  email: string;
  succeeded: boolean;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Historique des tentatives de connexion (réussies ou non), distinct de `AuditLog`
 * (réservé aux actions métier) — voir décision Jalon 2.5. Sert uniquement à
 * l'enregistrement pour l'instant ; l'analyse/détection d'anomalies est un futur
 * développement, pas construit ici.
 */
@Injectable()
export class LoginHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  record(params: RecordLoginAttemptParams): Promise<LoginHistory> {
    return this.prisma.loginHistory.create({ data: params });
  }

  findByUser(userId: string): Promise<LoginHistory[]> {
    return this.prisma.loginHistory.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}
