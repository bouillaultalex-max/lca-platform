import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import {
  FeedbackWebhookService,
  buildFeedbackWebhookPayload,
} from './feedback-webhook.service';
import { APP_VERSION } from '../app-version';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { Feedback, Prisma } from '../../generated/prisma/client';

export type FeedbackWithUser = Prisma.FeedbackGetPayload<{
  include: { user: { select: { id: true; fullName: true } } };
}>;

/**
 * Retours utilisateurs (bug/idée/amélioration/question) collectés pendant les
 * premiers tests réels (V0.3) — journal simple, append-only : pas de commentaires,
 * pas d'assignation, pas de notifications, 2 statuts seulement (NOUVEAU/TRAITE).
 */
@Injectable()
export class FeedbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly feedbackWebhookService: FeedbackWebhookService,
  ) {}

  /**
   * Notifie un scénario Make (voir FeedbackWebhookService) uniquement après succès
   * de l'écriture en base — jamais avant, jamais si la création échoue. L'appel est
   * non bloquant (voir `notify()`) : il n'ajoute aucun délai à la réponse renvoyée
   * ici, même si Make est lent ou indisponible.
   */
  async create(
    siteId: string,
    user: AuthenticatedUser,
    dto: CreateFeedbackDto,
  ): Promise<Feedback> {
    const feedback = await this.prisma.feedback.create({
      data: {
        siteId,
        userId: user.id,
        type: dto.type,
        priority: dto.priority,
        message: dto.message,
        pageUrl: dto.pageUrl,
        appVersion: APP_VERSION,
      },
    });

    this.feedbackWebhookService.notify(
      buildFeedbackWebhookPayload(feedback, user),
    );

    return feedback;
  }

  findAll(siteId: string): Promise<FeedbackWithUser[]> {
    return this.prisma.feedback.findMany({
      where: { siteId },
      include: { user: { select: { id: true, fullName: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async markAsTreated(siteId: string, id: string): Promise<Feedback> {
    const feedback = await this.prisma.feedback.findFirst({
      where: { id, siteId },
    });
    if (!feedback) {
      throw new NotFoundException(`Retour ${id} introuvable.`);
    }
    return this.prisma.feedback.update({
      where: { id },
      data: { status: 'TRAITE' },
    });
  }
}
