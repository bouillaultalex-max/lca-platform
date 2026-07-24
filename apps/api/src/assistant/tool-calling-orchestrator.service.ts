import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AI_PROVIDER,
  type AiProvider,
  type AiProviderMessage,
  type AiProviderOptions,
  type AiToolCallRequest,
  type AiToolResultPayload,
} from './providers/ai-provider.interface';
import type { AiToolSpec } from './providers/ai-tool-spec';
import { ToolRegistryService } from './tools/tool-registry.service';
import { ToolExecutorService } from './tools/tool-executor.service';
import { buildAiToolCatalog } from './tools/ai-tool-catalog';
import { ContextEngine } from './context-engine.service';
import type { AiMessage } from '../../generated/prisma/client';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';

const DEADLINE_MESSAGE = "L'assistant n'a pas répondu à temps.";

/** Contexte transversal d'un échange (un message utilisateur, un ou plusieurs
 * tours de tool calling) — construit une seule fois par AssistantService,
 * jamais recalculé à chaque tour (voir `deadline`, partagée entre tous les
 * tours pour éviter qu'un enchaînement de tours ne dépasse le budget global). */
export interface ToolCallingContext {
  user: AuthenticatedUser;
  signal: AbortSignal;
  /** Échéance absolue (`Date.now()` + délai configuré), calculée une seule fois. */
  deadline: number;
}

/** Entrée brute d'un échange (AI-05) : l'historique tel que chargé depuis la
 * base par AssistantService (jamais pré-filtré/mis en forme — voir
 * ContextEngine, seul responsable de décider ce qui est effectivement transmis
 * au fournisseur) et le nouveau message utilisateur, pas encore inclus dans
 * `history`. */
export interface ToolCallingInput {
  history: AiMessage[];
  newUserMessage: string;
}

/**
 * Événements produits par l'orchestrateur, consommés par AssistantService
 * (jamais de logique de raisonnement côté AssistantService — voir AI-04).
 * Vocabulaire volontairement plat : AssistantService n'a pas besoin de savoir
 * combien de tours ont eu lieu, seulement ce qui doit être persisté/diffusé.
 */
export type ToolCallingEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; name: string }
  | { type: 'tool_result'; name: string; success: boolean }
  | { type: 'done' }
  | { type: 'error'; message: string };

interface ToolCallingLimits {
  maxToolCalls: number;
  maxTurns: number;
  maxDepth: number;
}

/**
 * Toute la logique de raisonnement du tool calling (AI-04) : pilotage des
 * tours, exécution des outils, application des limites. AssistantService ne
 * fait qu'itérer sur `run()` pour décider quoi persister et quoi diffuser en
 * SSE — il ne connaît ni `AiProvider`, ni `ToolRegistryService`, ni
 * `ToolExecutorService`, ni le protocole interne de tool calling.
 *
 * Le registre est l'unique autorité (voir tools/tool-registry.service.ts) :
 * un outil ne peut être exécuté que via `ToolExecutorService.execute`, qui
 * recherche uniquement par nom exact dans une `Map` (aucune interprétation
 * libre, aucun nom dynamique, aucune exécution de code) et lève une exception
 * explicite pour un nom inconnu — cette exception est traitée ici exactement
 * comme n'importe quelle autre erreur d'outil (voir `runTurn`), jamais comme
 * une erreur de transport.
 *
 * `ContextEngine` (AI-05) est appelé exactement une fois par échange, ici
 * dans `run()`, jamais dans `runTurn()` : le raisonnement déjà commencé (tours,
 * ToolCall/ToolResult de l'échange courant) n'est jamais retronqué ni résumé —
 * `runTurn` reste par ailleurs strictement inchangée depuis AI-04 (tours,
 * profondeur, limites d'appels, exécution des outils).
 */
@Injectable()
export class ToolCallingOrchestrator {
  private readonly logger = new Logger(ToolCallingOrchestrator.name);

  constructor(
    @Inject(AI_PROVIDER) private readonly aiProvider: AiProvider,
    private readonly toolRegistry: ToolRegistryService,
    private readonly toolExecutor: ToolExecutorService,
    private readonly contextEngine: ContextEngine,
    private readonly configService: ConfigService,
  ) {}

  async *run(
    input: ToolCallingInput,
    options: AiProviderOptions,
    context: ToolCallingContext,
  ): AsyncGenerator<ToolCallingEvent> {
    const limits: ToolCallingLimits = {
      maxToolCalls: this.configService.get<number>('AI_MAX_TOOL_CALLS')!,
      maxTurns: this.configService.get<number>('AI_MAX_TOOL_CALL_TURNS')!,
      maxDepth: this.configService.get<number>('AI_MAX_TOOL_CALL_DEPTH')!,
    };
    // Construit une seule fois pour tout l'échange (potentiellement plusieurs
    // tours) : le registre ne change jamais pendant un échange.
    const toolCatalog = buildAiToolCatalog(this.toolRegistry.list());

    const request = this.contextEngine.prepare({
      history: input.history,
      newUserMessage: input.newUserMessage,
      toolCatalog,
      options,
    });
    // ContextEngine ne journalise jamais lui-même (préparateur pur) : c'est
    // ici, une seule fois par échange, que ses métadonnées sont journalisées —
    // jamais le contenu des messages ni le résumé complet (voir AI-05).
    this.logger.log(`Contexte préparé : ${JSON.stringify(request.metadata)}`);

    const initialMessages: AiProviderMessage[] = [
      request.system,
      request.context,
      ...request.messages,
    ];
    const toolCallState = { count: 0 };

    yield* this.runTurn(
      initialMessages,
      request.tools,
      request.options,
      context,
      limits,
      1,
      toolCallState,
    );
  }

  private async *runTurn(
    messages: AiProviderMessage[],
    toolCatalog: AiToolSpec[],
    options: AiProviderOptions,
    context: ToolCallingContext,
    limits: ToolCallingLimits,
    turnNumber: number,
    toolCallState: { count: number },
  ): AsyncGenerator<ToolCallingEvent> {
    if (turnNumber > limits.maxTurns) {
      yield {
        type: 'error',
        message: 'Nombre maximal de tours de raisonnement atteint.',
      };
      return;
    }
    // Distincte de maxTurns (même axe, plafond indépendamment configurable) :
    // voir AI-04, `runTurn` est appelée récursivement, une récursion par tour.
    if (turnNumber > limits.maxDepth) {
      yield {
        type: 'error',
        message:
          "Profondeur maximale d'imbrication des appels d'outils atteinte.",
      };
      return;
    }

    if (context.signal.aborted) return;
    if (context.deadline - Date.now() <= 0) {
      yield { type: 'error', message: DEADLINE_MESSAGE };
      return;
    }

    const pendingCalls: AiToolCallRequest[] = [];

    try {
      const stream = this.aiProvider.streamResponse(
        messages,
        toolCatalog,
        options,
        context.signal,
      );
      const iterator = stream[Symbol.asyncIterator]();

      while (true) {
        if (context.signal.aborted) return;

        const remainingMs = context.deadline - Date.now();
        if (remainingMs <= 0) {
          yield { type: 'error', message: DEADLINE_MESSAGE };
          return;
        }

        let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
        const result = await Promise.race([
          iterator.next(),
          new Promise<never>((_resolve, reject) => {
            timeoutHandle = setTimeout(
              () => reject(new Error(DEADLINE_MESSAGE)),
              remainingMs,
            );
          }),
        ]).finally(() => clearTimeout(timeoutHandle));

        if (result.done) break;
        const chunk = result.value;

        if (chunk.type === 'text') {
          yield { type: 'text', delta: chunk.delta };
        } else if (chunk.type === 'tool_call') {
          pendingCalls.push({
            id: chunk.id,
            name: chunk.name,
            input: chunk.input,
          });
          yield { type: 'tool_call', name: chunk.name };
        } else if (chunk.type === 'error') {
          yield { type: 'error', message: chunk.message };
          return;
        }
      }
    } catch (err) {
      const message =
        err instanceof Error && err.message === DEADLINE_MESSAGE
          ? DEADLINE_MESSAGE
          : 'Une erreur est survenue pendant la génération de la réponse.';
      yield { type: 'error', message };
      return;
    }

    if (pendingCalls.length === 0) {
      yield { type: 'done' };
      return;
    }

    const toolResultMessages: AiProviderMessage[] = [];
    for (const call of pendingCalls) {
      toolCallState.count += 1;
      if (toolCallState.count > limits.maxToolCalls) {
        yield {
          type: 'error',
          message: "Nombre maximal d'appels d'outils atteint.",
        };
        return;
      }

      const payload = await this.executeTool(context.user, call);
      yield { type: 'tool_result', name: call.name, success: payload.success };
      toolResultMessages.push({
        role: 'tool_result',
        toolCallId: call.id,
        name: call.name,
        payload,
      });
    }

    const nextMessages: AiProviderMessage[] = [
      ...messages,
      { role: 'assistant_tool_call', toolCalls: pendingCalls },
      ...toolResultMessages,
    ];

    yield* this.runTurn(
      nextMessages,
      toolCatalog,
      options,
      context,
      limits,
      turnNumber + 1,
      toolCallState,
    );
  }

  /**
   * Exécute un outil et convertit systématiquement le résultat — succès ou
   * échec — en `AiToolResultPayload` : une permission refusée, une entrée
   * invalide, un outil inconnu ou une donnée absente sont toutes des erreurs
   * d'outil (voir ToolExecutorService, AI-03), jamais des erreurs de transport
   * qui interrompraient tout l'échange.
   */
  private async executeTool(
    user: AuthenticatedUser,
    call: AiToolCallRequest,
  ): Promise<AiToolResultPayload> {
    try {
      const result = await this.toolExecutor.execute(
        user,
        call.name,
        call.input,
      );
      return { success: true, result };
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Erreur inconnue lors de l'exécution de l'outil.";
      return { success: false, error: message };
    }
  }
}
