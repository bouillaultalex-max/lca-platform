import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { Feedback } from '../../generated/prisma/client';

const TIMEOUT_MS = 2000;

/**
 * Payload envoyé au scénario Make (voir FeedbackWebhookService). Liste blanche
 * explicite : ne jamais construire cet objet par spread (`...feedback`/`...user`),
 * pour garantir qu'aucun champ sensible (hash de mot de passe, etc.) ne puisse un
 * jour s'y glisser silencieusement.
 */
export interface FeedbackWebhookPayload {
  feedbackId: string;
  user: string;
  email: string;
  type: string;
  priority: string;
  page: string;
  message: string;
  version: string;
  status: string;
  createdAt: string;
  siteId: string;
}

export function buildFeedbackWebhookPayload(
  feedback: Feedback,
  user: AuthenticatedUser,
): FeedbackWebhookPayload {
  return {
    feedbackId: feedback.id,
    user: user.fullName,
    email: user.email,
    type: feedback.type,
    priority: feedback.priority,
    page: feedback.pageUrl,
    message: feedback.message,
    version: feedback.appVersion,
    status: feedback.status,
    createdAt: feedback.createdAt.toISOString(),
    siteId: feedback.siteId,
  };
}

/**
 * Relaie un retour utilisateur créé vers un scénario Make (webhook -> agent IA ->
 * Gmail), configuré exclusivement via `MAKE_FEEDBACK_WEBHOOK_URL` (voir
 * `.env.example`). Volontairement isolé de Prisma et de la logique de création : ce
 * service ne connaît que le payload à envoyer, jamais `FeedbackService` ni la base.
 *
 * Intégration non bloquante par construction : `notify()` ne retourne rien
 * (jamais de Promise à attendre par erreur) et l'envoi réel (`send`) absorbe
 * systématiquement toute erreur réseau, timeout ou statut HTTP non-2xx sans jamais
 * la laisser remonter — aucune promesse non gérée possible. Si
 * `MAKE_FEEDBACK_WEBHOOK_URL` est absente ou vide, aucun appel n'est effectué : le
 * reste du système de retours continue de fonctionner normalement.
 */
@Injectable()
export class FeedbackWebhookService {
  private readonly logger = new Logger(FeedbackWebhookService.name);
  private readonly webhookUrl: string | undefined;

  constructor(configService: ConfigService) {
    this.webhookUrl =
      configService.get<string>('MAKE_FEEDBACK_WEBHOOK_URL') || undefined;
  }

  notify(payload: FeedbackWebhookPayload): void {
    if (!this.webhookUrl) return;
    void this.send(this.webhookUrl, payload);
  }

  private async send(
    url: string,
    payload: FeedbackWebhookPayload,
  ): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) {
        this.logger.warn(
          `Échec de l'envoi de la notification Make (statut ${response.status}).`,
        );
      }
    } catch {
      this.logger.warn(
        "Échec de l'envoi de la notification Make (délai dépassé ou erreur réseau).",
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
