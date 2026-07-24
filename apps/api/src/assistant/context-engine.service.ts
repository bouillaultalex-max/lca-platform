import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AiMessage } from '../../generated/prisma/client';
import type {
  AiProviderMessage,
  AiProviderOptions,
} from './providers/ai-provider.interface';
import type { AiToolSpec } from './providers/ai-tool-spec';
import type {
  AiProviderRequest,
  ContextPreparationMetadata,
} from './context/ai-provider-request';
import { ASSISTANT_CLOCK, type Clock } from './context/clock';
import { SYSTEM_PROMPT } from './context/system-prompt';
import { buildStaticContext } from './context/static-context.util';
import { estimateTokens } from './context/token-estimator.util';
import { truncateToMaxChars } from './context/truncate-message.util';
import { buildDeterministicSummary } from './context/conversation-summary.util';

export interface ContextEnginePrepareInput {
  /** Historique brut chargé depuis la base, ordre chronologique croissant,
   * AVANT le nouveau message utilisateur (voir AssistantService). Peut
   * contenir des lignes USER/ASSISTANT/TOOL_CALL. */
  history: AiMessage[];
  /** Message que l'utilisateur vient de taper — jamais inclus dans `history`. */
  newUserMessage: string;
  /** Catalogue déjà construit par ToolCallingOrchestrator (voir
   * tools/ai-tool-catalog.ts) — ContextEngine ne connaît jamais
   * ToolRegistryService, uniquement ce tableau déjà neutre. */
  toolCatalog: AiToolSpec[];
  options: AiProviderOptions;
}

interface ContextEngineConfig {
  maxTokens: number;
  maxMessages: number;
  maxMessageChars: number;
  recentMessagesMin: number;
}

interface HistoricalTurn {
  raw: AiMessage;
  message: { role: 'user' | 'assistant'; content: string };
  wasTruncated: boolean;
  truncatedChars: number;
}

/**
 * Prépare exactement ce qui sera envoyé au fournisseur (AI-05) : prompt
 * système, contexte statique, sélection/troncature/résumé de l'historique,
 * catalogue d'outils — jamais l'historique brut directement. Appelé une seule
 * fois par message utilisateur (voir ToolCallingOrchestrator.run()), jamais
 * rappelé entre deux tours de tool calling : le raisonnement en cours (tours,
 * ToolCall/ToolResult de l'échange courant) n'est jamais retronqué ni résumé
 * ici, uniquement construit par la boucle existante à partir du résultat de
 * `prepare()`.
 *
 * Aucune dépendance base de données : reçoit `history` déjà chargé par
 * l'appelant. Aucun accès à ToolRegistryService/ToolExecutorService/Prisma.
 * Préparateur pur, sans effet de bord (pas de Logger) : retourne des
 * métadonnées, ne journalise jamais lui-même (voir ai-provider-request.ts).
 */
@Injectable()
export class ContextEngine {
  constructor(
    private readonly configService: ConfigService,
    @Inject(ASSISTANT_CLOCK) private readonly clock: Clock,
  ) {}

  prepare(input: ContextEnginePrepareInput): AiProviderRequest {
    const startedAt = Date.now();
    const config = this.readConfig();

    const system: AiProviderMessage = {
      role: 'system',
      content: SYSTEM_PROMPT,
    };
    const context: AiProviderMessage = {
      role: 'system',
      content: buildStaticContext(this.clock),
    };

    const userTruncation = truncateToMaxChars(
      input.newUserMessage,
      config.maxMessageChars,
    );
    const newUserMessage: AiProviderMessage = {
      role: 'user',
      content: userTruncation.content,
    };

    const fixedCount = 3; // system + context + newUserMessage
    const fixedTokens =
      estimateTokens(system.content) +
      estimateTokens(context.content) +
      estimateTokens(newUserMessage.content);

    const turns = this.buildHistoricalTurns(
      input.history,
      config.maxMessageChars,
    );
    const { kept, discardedCount } = this.selectRecentTurns(
      turns,
      config,
      fixedTokens,
      fixedCount,
    );

    let summary: AiProviderMessage | null = null;
    let finalKept = kept;
    let finalDiscardedCount = discardedCount;

    if (discardedCount > 0 && kept.length < config.recentMessagesMin) {
      const reserved = this.reserveRoomForSummary(
        kept,
        input.history,
        config,
        fixedTokens,
        fixedCount,
      );
      finalKept = reserved.kept;
      finalDiscardedCount = turns.length - reserved.kept.length;
      summary = { role: 'system', content: reserved.summaryText };
    }

    const historicalMessages = finalKept.map((t) => t.message);
    const messages: AiProviderMessage[] = [
      ...(summary ? [summary] : []),
      ...historicalMessages,
      newUserMessage,
    ];

    const toolCallCount = input.history.filter(
      (m) => m.role === 'TOOL_CALL',
    ).length;

    const truncatedInFinalOutput = [
      ...(userTruncation.truncated
        ? [{ truncatedChars: userTruncation.truncatedChars }]
        : []),
      ...finalKept
        .filter((t) => t.wasTruncated)
        .map((t) => ({ truncatedChars: t.truncatedChars })),
    ];

    const metadata: ContextPreparationMetadata = {
      estimatedTokens:
        estimateTokens(system.content) +
        estimateTokens(context.content) +
        (summary ? estimateTokens(summary.content) : 0) +
        historicalMessages.reduce(
          (sum, m) => sum + estimateTokens(m.content),
          0,
        ) +
        estimateTokens(newUserMessage.content),
      messageCount: 2 + messages.length,
      systemMessageCount: 2 + (summary ? 1 : 0),
      historicalMessageCount: finalKept.length,
      discardedHistoricalMessageCount: finalDiscardedCount,
      toolCallCount,
      // ContextEngine ne voit jamais de ToolResult : ils n'existent qu'en
      // mémoire pendant la boucle de tool calling, après cet appel initial,
      // et ne sont jamais persistés (AI-04) — donc jamais présents ici.
      toolResultCount: 0,
      summaryIncluded: summary !== null,
      truncatedMessageCount: truncatedInFinalOutput.length,
      truncatedCharacterCount: truncatedInFinalOutput.reduce(
        (sum, t) => sum + t.truncatedChars,
        0,
      ),
      preparationDurationMs: Date.now() - startedAt,
    };

    return {
      system,
      context,
      messages,
      tools: input.toolCatalog,
      options: input.options,
      metadata,
    };
  }

  private readConfig(): ContextEngineConfig {
    return {
      maxTokens: this.configService.get<number>('AI_CONTEXT_MAX_TOKENS')!,
      maxMessages: this.configService.get<number>('AI_CONTEXT_MAX_MESSAGES')!,
      maxMessageChars: this.configService.get<number>(
        'AI_CONTEXT_MAX_MESSAGE_CHARS',
      )!,
      recentMessagesMin: this.configService.get<number>(
        'AI_CONTEXT_RECENT_MESSAGES_MIN',
      )!,
    };
  }

  /** Ne conserve que les tours rejouables (USER/ASSISTANT) — les lignes
   * TOOL_CALL ne sont jamais rejouées comme de faux résultats d'outils (elles
   * ne servent qu'au résumé, voir buildDeterministicSummary). */
  private buildHistoricalTurns(
    history: AiMessage[],
    maxMessageChars: number,
  ): HistoricalTurn[] {
    const turns: HistoricalTurn[] = [];
    for (const raw of history) {
      if (raw.role !== 'USER' && raw.role !== 'ASSISTANT') continue;
      const truncation = truncateToMaxChars(raw.content, maxMessageChars);
      turns.push({
        raw,
        message: {
          role: raw.role === 'USER' ? 'user' : 'assistant',
          content: truncation.content,
        },
        wasTruncated: truncation.truncated,
        truncatedChars: truncation.truncatedChars,
      });
    }
    return turns;
  }

  /** Parcourt l'historique du plus récent au plus ancien, en conservant tant
   * que le budget de jetons ET le nombre maximal de messages le permettent
   * simultanément — jamais l'un sans l'autre (voir AI-05 : « la sortie doit
   * toujours respecter toutes les limites configurées »). */
  private selectRecentTurns(
    turns: HistoricalTurn[],
    config: ContextEngineConfig,
    fixedTokens: number,
    fixedCount: number,
  ): { kept: HistoricalTurn[]; discardedCount: number } {
    const keptReversed: HistoricalTurn[] = [];
    let runningTokens = 0;

    for (let i = turns.length - 1; i >= 0; i -= 1) {
      const candidate = turns[i];
      const cost = estimateTokens(candidate.message.content);
      const wouldExceedTokens =
        fixedTokens + runningTokens + cost > config.maxTokens;
      const wouldExceedCount =
        fixedCount + keptReversed.length + 1 > config.maxMessages;
      if (wouldExceedTokens || wouldExceedCount) break;
      keptReversed.push(candidate);
      runningTokens += cost;
    }

    const kept = [...keptReversed].reverse();
    return { kept, discardedCount: turns.length - kept.length };
  }

  /**
   * Le plancher `recentMessagesMin` n'aurait pas été atteint par une simple
   * troncature silencieuse : on résume plutôt l'historique écarté. Réserve la
   * place nécessaire (jetons + un message) au résumé en retirant, si besoin,
   * les tours conservés les plus anciens — jamais au prix de dépasser
   * `maxTokens`/`maxMessages` (limites toujours respectées en priorité).
   */
  private reserveRoomForSummary(
    kept: HistoricalTurn[],
    fullHistory: AiMessage[],
    config: ContextEngineConfig,
    fixedTokens: number,
    fixedCount: number,
  ): { kept: HistoricalTurn[]; summaryText: string } {
    const mutableKept = [...kept];

    const cutoffIndex = (current: HistoricalTurn[]): number =>
      current.length > 0
        ? fullHistory.indexOf(current[0].raw)
        : fullHistory.length;

    let summaryText = buildDeterministicSummary(
      fullHistory.slice(0, cutoffIndex(mutableKept)),
    );
    let summaryTokens = estimateTokens(summaryText);

    const fitsWithSummary = (): boolean => {
      const keptTokens = mutableKept.reduce(
        (sum, t) => sum + estimateTokens(t.message.content),
        0,
      );
      const totalCount = fixedCount + mutableKept.length + 1; // +1 = résumé
      const totalTokens = fixedTokens + keptTokens + summaryTokens;
      return (
        totalCount <= config.maxMessages && totalTokens <= config.maxTokens
      );
    };

    while (mutableKept.length > 0 && !fitsWithSummary()) {
      mutableKept.shift();
      summaryText = buildDeterministicSummary(
        fullHistory.slice(0, cutoffIndex(mutableKept)),
      );
      summaryTokens = estimateTokens(summaryText);
    }

    return { kept: mutableKept, summaryText };
  }
}
