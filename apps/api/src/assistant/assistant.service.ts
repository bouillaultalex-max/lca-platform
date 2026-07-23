import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import {
  AI_PROVIDER,
  type AiProvider,
  type AiProviderMessage,
} from './providers/ai-provider.interface';
import { ToolRegistryService } from './tools/tool-registry.service';
import { SendAssistantMessageDto } from './dto/send-assistant-message.dto';
import type { AssistantSseEvent } from './types/assistant-sse-event';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { AiConversation } from '../../generated/prisma/client';

const TIMEOUT_MESSAGE = "L'assistant n'a pas répondu à temps.";

/**
 * Orchestrateur de l'assistant IA (AI-02, infrastructure uniquement) :
 * - ne contient aucune logique métier, aucun outil, aucune action ;
 * - ne connaît jamais un SDK de fournisseur concret (voir AiProvider) ;
 * - persiste la conversation (minimal : id/rôle/contenu/horodatage) ;
 * - journalise chaque appel (utilisateur, conversation, durée, modèle,
 *   succès/échec) via le Logger applicatif standard — un journal dédié en base
 *   (au-delà de la conversation elle-même) est différé à AI-05 (voir AI-01 §12).
 */
@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(AI_PROVIDER) private readonly aiProvider: AiProvider,
    private readonly toolRegistry: ToolRegistryService,
    private readonly configService: ConfigService,
  ) {}

  private async getOrCreateConversation(
    user: AuthenticatedUser,
    conversationId: string | undefined,
  ): Promise<AiConversation> {
    if (!conversationId) {
      return this.prisma.aiConversation.create({
        data: { siteId: user.siteId, userId: user.id },
      });
    }

    const conversation = await this.prisma.aiConversation.findFirst({
      where: { id: conversationId, siteId: user.siteId, userId: user.id },
    });
    if (!conversation) {
      throw new NotFoundException(
        `Conversation ${conversationId} introuvable.`,
      );
    }
    return conversation;
  }

  /**
   * Flux d'événements SSE pour un message envoyé par l'utilisateur — voir
   * AssistantController pour l'écriture réelle des trames HTTP. Générateur
   * asynchrone : le contrôleur peut arrêter la consommation à tout moment
   * (annulation côté client). `signal` (AI-03) est transmis tel quel au
   * fournisseur et vérifié entre chaque fragment, pour cesser d'interroger le
   * fournisseur dès l'annulation — sans quoi seule l'écriture HTTP s'arrêterait
   * (voir AssistantController), pas la génération elle-même.
   */
  async *streamMessage(
    user: AuthenticatedUser,
    dto: SendAssistantMessageDto,
    signal: AbortSignal,
  ): AsyncGenerator<AssistantSseEvent> {
    const startedAt = Date.now();
    const model = this.configService.get<string>('AI_MODEL')!;
    const requestTimeoutMs = this.configService.get<number>(
      'AI_REQUEST_TIMEOUT_MS',
    )!;
    const maxOutputTokens = this.configService.get<number>(
      'AI_MAX_OUTPUT_TOKENS',
    )!;

    let conversation: AiConversation;
    try {
      conversation = await this.getOrCreateConversation(
        user,
        dto.conversationId,
      );
    } catch (err) {
      this.logOutcome(user, dto.conversationId, model, startedAt, false, err);
      yield { type: 'error', message: (err as Error).message };
      return;
    }

    yield { type: 'conversation', conversationId: conversation.id };

    await this.prisma.aiMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'USER',
        content: dto.content,
      },
    });

    const history = await this.prisma.aiMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'asc' },
    });
    const providerMessages: AiProviderMessage[] = history.map((message) => ({
      role: message.role === 'USER' ? 'user' : 'assistant',
      content: message.content,
    }));

    let assembledResponse = '';
    try {
      const stream = this.aiProvider.streamResponse(
        providerMessages,
        this.toolRegistry.list(),
        {
          model,
          maxOutputTokens,
        },
        signal,
      );
      const iterator = stream[Symbol.asyncIterator]();
      const deadline = startedAt + requestTimeoutMs;

      while (true) {
        // Annulation cliente : arrêt propre (pas une erreur), avant même de
        // redemander un fragment au fournisseur — voir AI-03.
        if (signal.aborted) break;

        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) {
          throw new Error(TIMEOUT_MESSAGE);
        }

        // Course entre la prochaine étape du fournisseur et le budget de temps
        // restant : un fournisseur qui ne répond jamais ne bloque jamais la
        // requête au-delà de AI_REQUEST_TIMEOUT_MS (voir AI-01 §7). Le minuteur
        // est systématiquement nettoyé (`finally`), qu'il ait gagné la course ou
        // non, pour ne jamais laisser un timer actif derrière une requête déjà
        // terminée.
        let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
        const result = await Promise.race([
          iterator.next(),
          new Promise<never>((_resolve, reject) => {
            timeoutHandle = setTimeout(
              () => reject(new Error(TIMEOUT_MESSAGE)),
              remainingMs,
            );
          }),
        ]).finally(() => clearTimeout(timeoutHandle));

        if (result.done) break;
        const chunk = result.value;
        if (chunk.type === 'text') {
          assembledResponse += chunk.delta;
          yield { type: 'chunk', delta: chunk.delta };
        } else if (chunk.type === 'error') {
          throw new Error(chunk.message);
        }
      }

      if (assembledResponse.length > 0) {
        await this.prisma.aiMessage.create({
          data: {
            conversationId: conversation.id,
            role: 'ASSISTANT',
            content: assembledResponse,
          },
        });
      }

      // Pas de `done` si le client a déjà annulé : plus personne n'écoute
      // (voir AssistantController), et ce n'est pas une erreur à signaler.
      if (!signal.aborted) {
        yield { type: 'done' };
      }
      this.logOutcome(user, conversation.id, model, startedAt, true);
    } catch (err) {
      this.logOutcome(user, conversation.id, model, startedAt, false, err);
      yield {
        type: 'error',
        message: 'Une erreur est survenue pendant la génération de la réponse.',
      };
    }
  }

  private logOutcome(
    user: AuthenticatedUser,
    conversationId: string | undefined,
    model: string,
    startedAt: number,
    success: boolean,
    error?: unknown,
  ): void {
    const durationMs = Date.now() - startedAt;
    const context = {
      userId: user.id,
      conversationId,
      model,
      durationMs,
      success,
    };
    if (success) {
      this.logger.log(`Réponse assistant générée : ${JSON.stringify(context)}`);
    } else {
      this.logger.error(
        `Échec de la génération assistant : ${JSON.stringify(context)}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
