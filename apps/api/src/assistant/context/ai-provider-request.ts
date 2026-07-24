import type {
  AiProviderMessage,
  AiProviderOptions,
} from '../providers/ai-provider.interface';
import type { AiToolSpec } from '../providers/ai-tool-spec';

/**
 * Métadonnées de préparation du contexte (AI-05) — jamais de contenu de
 * message, jamais de résumé complet, jamais de paramètre ni de résultat
 * d'outil (voir ContextEngine.prepare()) : uniquement des compteurs et des
 * indicateurs, destinés à être journalisés par l'appelant (jamais par
 * ContextEngine lui-même, qui reste un préparateur pur sans effet de bord).
 */
export interface ContextPreparationMetadata {
  estimatedTokens: number;
  /** Nombre total de messages transmis au fournisseur (system + contexte +
   * résumé éventuel + historique conservé + nouveau message utilisateur). */
  messageCount: number;
  /** Nombre de messages de rôle `system` transmis (prompt système + contexte
   * statique + résumé éventuel, qui utilise lui aussi ce rôle). */
  systemMessageCount: number;
  /** Nombre de messages historiques (USER/ASSISTANT) effectivement conservés. */
  historicalMessageCount: number;
  /** Nombre de messages historiques écartés (au-delà du minimum demandé par
   * AI-05, utile pour l'observabilité de la troncature). */
  discardedHistoricalMessageCount: number;
  /** Nombre de lignes TOOL_CALL trouvées dans tout l'historique reçu. */
  toolCallCount: number;
  /** Toujours 0 : ContextEngine ne voit jamais de ToolResult, qui n'existent
   * qu'en mémoire pendant la boucle de tool calling, après son appel initial
   * (voir ToolCallingOrchestrator) — jamais persistés (AI-04). */
  toolResultCount: number;
  summaryIncluded: boolean;
  /** Nombre de messages dont le contenu a été tronqué (voir
   * truncate-message.util.ts) parmi ceux effectivement transmis. */
  truncatedMessageCount: number;
  /** Total des caractères retirés par troncature parmi les messages transmis. */
  truncatedCharacterCount: number;
  preparationDurationMs: number;
}

/**
 * Contrat officiel, provider-agnostic, entre le Context Engine et un
 * `AiProvider` (AI-05) : aucun format OpenAI/Anthropic/Ollama/Mistral n'y
 * apparaît, uniquement les types déjà établis en AI-04
 * (`AiProviderMessage`/`AiToolSpec`/`AiProviderOptions`). `ToolCallingOrchestrator`
 * dépaquette cette structure avant d'appeler `AiProvider.streamResponse`
 * (signature inchangée, voir ai-provider.interface.ts) — le provider lui-même
 * ne reçoit jamais un `AiProviderRequest` tel quel.
 */
export interface AiProviderRequest {
  /** Prompt système minimal (voir system-prompt.ts), rôle `system`. */
  system: AiProviderMessage;
  /** Contexte statique (date, heure, langue, fuseau horaire, version — voir
   * static-context.util.ts), rôle `system`, jamais de donnée métier. */
  context: AiProviderMessage;
  /** Résumé déterministe éventuel (rôle `system`) + historique conservé
   * (USER/ASSISTANT) + nouveau message utilisateur, dans cet ordre chronologique. */
  messages: AiProviderMessage[];
  /** Catalogue des 6 outils métier existants, toujours transmis en entier. */
  tools: AiToolSpec[];
  options: AiProviderOptions;
  metadata: ContextPreparationMetadata;
}
