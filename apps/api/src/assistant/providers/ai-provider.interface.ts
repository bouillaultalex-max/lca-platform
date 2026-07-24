/**
 * Abstraction du fournisseur IA (voir docs/adr et AI-01) : le reste du code
 * (AssistantService, AssistantController) ne connaît jamais un SDK concret,
 * uniquement cette interface. `EchoAiProvider` (voir echo-ai-provider.service.ts)
 * sert d'implémentation temporaire pour exercer toute la chaîne (orchestrateur,
 * SSE, persistance, tool calling — AI-04) sans dépendre d'un fournisseur réel.
 *
 * Protocole de tool calling (AI-04) : entièrement interne, indépendant des
 * formats OpenAI/Anthropic — chaque futur fournisseur réel traduit dans les
 * deux sens (voir AiToolSpec dans ai-tool-spec.ts pour la description des
 * outils, et ToolCallingOrchestrator pour le pilotage des tours).
 */
import type { AiToolSpec } from './ai-tool-spec';

/** Un appel d'outil demandé par le fournisseur (chunk `tool_call`), ou tel que
 * réinjecté dans l'historique du tour suivant (message `assistant_tool_call`). */
export interface AiToolCallRequest {
  /** Identifiant de corrélation propre à cet échange (voir AiProviderStreamChunk) —
   * jamais persisté, jamais exposé au-delà de l'orchestrateur. */
  id: string;
  /** Nom déclaré dans le registre (voir tools/tool-registry.service.ts) — le
   * fournisseur ne peut choisir que parmi les noms reçus via `tools` (AiToolSpec[]). */
  name: string;
  input: unknown;
}

/** Résultat d'un outil tel que réinjecté au fournisseur — jamais l'objet interne
 * renvoyé par le service métier tel quel : voir ToolCallingOrchestrator, qui
 * construit ce type à partir du retour de ToolExecutorService. Une erreur d'outil
 * (permission refusée, validation, donnée absente, outil inconnu, ...) est
 * toujours ici, jamais un chunk `error` du protocole de streaming (AI-04). */
export type AiToolResultPayload =
  { success: true; result: unknown } | { success: false; error: string };

/** Message de l'historique de conversation transmis au fournisseur — étendu en
 * AI-04 pour porter les tours de tool calling de l'échange en cours (jamais
 * persistés tels quels, voir AssistantService : seuls USER/ASSISTANT/TOOL_CALL
 * sont écrits en base, ToolResult reste strictement éphémère). `system` (AI-05,
 * voir context/system-prompt.ts et ContextEngine) : un vrai rôle dédié, jamais
 * un prompt système déguisé en faux message `assistant`. */
export type AiProviderMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string }
  | { role: 'system'; content: string }
  | { role: 'assistant_tool_call'; toolCalls: AiToolCallRequest[] }
  | {
      role: 'tool_result';
      toolCallId: string;
      name: string;
      payload: AiToolResultPayload;
    };

/** Fragment de réponse en flux, émis au fur et à mesure par le fournisseur.
 * `tool_call` (AI-04) : le fournisseur demande l'exécution d'un outil déclaré
 * dans `tools` (voir streamResponse ci-dessous) — jamais un nom ou un format
 * arbitraire, uniquement ce protocole interne. */
export type AiProviderStreamChunk =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; id: string; name: string; input: unknown }
  | { type: 'done' }
  | { type: 'error'; message: string };

export interface AiProviderOptions {
  model: string;
  maxOutputTokens: number;
}

/**
 * Contrat minimal qu'un fournisseur IA doit respecter. `tools` est le contrat
 * neutre `AiToolSpec[]` (AI-04, voir ai-tool-spec.ts) : un provider ne connaît
 * jamais `ToolDefinition`, `ToolRegistryService` ni `ToolExecutorService` (voir
 * tools/ai-tool-catalog.ts pour la traduction, effectuée avant l'appel à
 * `streamResponse`, jamais par le provider lui-même). `signal` est propagé
 * depuis la requête HTTP en passant par AssistantService puis
 * ToolCallingOrchestrator, sans rien changer d'autre à cette chaîne : une
 * implémentation réelle doit le transmettre à son appel réseau sous-jacent
 * (ex: `fetch(url, { signal })`) pour honorer l'annulation cliente.
 */
export interface AiProvider {
  streamResponse(
    messages: AiProviderMessage[],
    tools: AiToolSpec[],
    options: AiProviderOptions,
    signal: AbortSignal,
  ): AsyncIterable<AiProviderStreamChunk>;
}

/** Jeton d'injection Nest : permet d'injecter n'importe quelle implémentation
 * de `AiProvider` sans que les consommateurs connaissent la classe concrète. */
export const AI_PROVIDER = Symbol('AI_PROVIDER');
