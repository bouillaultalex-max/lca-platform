import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import type { AiProviderMessage } from './providers/ai-provider.interface';
import {
  ToolCallingOrchestrator,
  type ToolCallingContext,
} from './tool-calling-orchestrator.service';
import { SendAssistantMessageDto } from './dto/send-assistant-message.dto';
import type { AssistantSseEvent } from './types/assistant-sse-event';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { AiConversation, AiMessage } from '../../generated/prisma/client';

/**
 * Orchestrateur de conversation de l'assistant IA — ne contient **aucune**
 * logique de raisonnement ni de tool calling (voir ToolCallingOrchestrator,
 * AI-04, qui pilote les tours et exécute les outils) : ce service ne fait que
 * gérer les conversations, persister les messages, traduire en SSE et
 * journaliser l'issue globale d'un échange.
 *
 * Persistance (AI-04) : USER et ASSISTANT (texte final) comme avant, plus
 * TOOL_CALL (nom de l'outil uniquement) pour chaque appel demandé par le
 * modèle — jamais de ToolResult ni de donnée métier renvoyée par un outil,
 * qui restent strictement éphémères (voir ToolCallingOrchestrator).
 */
@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orchestrator: ToolCallingOrchestrator,
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
   * Historique renvoyé au fournisseur pour une NOUVELLE requête : uniquement
   * les messages texte (USER/ASSISTANT). Les lignes TOOL_CALL persistées
   * existent pour l'audit (voir classe ci-dessus) mais ne sont jamais
   * rejouées telles quelles — sans leur ToolResult (jamais persisté), elles ne
   * représentent pas un tour valide pour un fournisseur (AI-04, mémoire
   * minimale : seule la réponse finale déjà formulée est "mémorisée" d'un
   * échange à l'autre).
   */
  private toProviderMessages(history: AiMessage[]): AiProviderMessage[] {
    return history
      .filter(
        (message) => message.role === 'USER' || message.role === 'ASSISTANT',
      )
      .map((message) => ({
        role: message.role === 'USER' ? 'user' : 'assistant',
        content: message.content,
      }));
  }

  /**
   * Flux d'événements SSE pour un message envoyé par l'utilisateur — voir
   * AssistantController pour l'écriture réelle des trames HTTP. Générateur
   * asynchrone : le contrôleur peut arrêter la consommation à tout moment
   * (annulation côté client). `signal` est transmis tel quel à
   * ToolCallingOrchestrator via `ToolCallingContext`.
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
    const providerMessages = this.toProviderMessages(history);

    const context: ToolCallingContext = {
      user,
      signal,
      deadline: startedAt + requestTimeoutMs,
    };

    let assembledResponse = '';
    let receivedDone = false;
    try {
      for await (const event of this.orchestrator.run(
        providerMessages,
        { model, maxOutputTokens },
        context,
      )) {
        if (event.type === 'text') {
          assembledResponse += event.delta;
          yield { type: 'chunk', delta: event.delta };
        } else if (event.type === 'tool_call') {
          await this.prisma.aiMessage.create({
            data: {
              conversationId: conversation.id,
              role: 'TOOL_CALL',
              content: '',
              toolName: event.name,
            },
          });
          yield { type: 'tool_call', name: event.name };
        } else if (event.type === 'tool_result') {
          // Jamais persisté (voir classe ci-dessus) : strictement éphémère.
          yield {
            type: 'tool_result',
            name: event.name,
            success: event.success,
          };
        } else if (event.type === 'error') {
          throw new Error(event.message);
        } else if (event.type === 'done') {
          receivedDone = true;
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

      // Pas de `done` si l'orchestrateur ne l'a jamais émis (annulation ou
      // erreur déjà signalée) : plus personne n'écoute ou une erreur a déjà
      // été renvoyée, dans les deux cas ce n'est pas un succès à signaler.
      if (receivedDone) {
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
