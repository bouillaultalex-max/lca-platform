/**
 * Abstraction du fournisseur IA (voir docs/adr et AI-01) : le reste du code
 * (AssistantService, AssistantController) ne connaît jamais un SDK concret,
 * uniquement cette interface. Le fournisseur réel sera injecté par dépendance
 * (voir AI_PROVIDER ci-dessous) dans un ticket ultérieur (AI-03+) ; en attendant,
 * `EchoAiProvider` (voir echo-ai-provider.service.ts) sert d'implémentation
 * temporaire pour exercer toute la chaîne (orchestrateur, SSE, persistance)
 * sans dépendre d'un fournisseur réel ni d'un appel réseau payant.
 */
import type { ToolDefinition } from '../tools/tool.types';

/** Un message de l'historique de conversation transmis au fournisseur. */
export interface AiProviderMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Fragment de réponse en flux, émis au fur et à mesure par le fournisseur. */
export type AiProviderStreamChunk =
  | { type: 'text'; delta: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

export interface AiProviderOptions {
  model: string;
  maxOutputTokens: number;
}

/**
 * Contrat minimal qu'un fournisseur IA doit respecter. `tools` provient toujours
 * du registre (voir tools/tool-registry.service.ts), vide en AI-02 : un
 * fournisseur réel branché plus tard (AI-03+) recevra la liste à jour sans
 * qu'AssistantService ait besoin d'être modifié pour la lui transmettre.
 */
export interface AiProvider {
  streamResponse(
    messages: AiProviderMessage[],
    tools: ToolDefinition[],
    options: AiProviderOptions,
  ): AsyncIterable<AiProviderStreamChunk>;
}

/** Jeton d'injection Nest : permet d'injecter n'importe quelle implémentation
 * de `AiProvider` sans que les consommateurs connaissent la classe concrète. */
export const AI_PROVIDER = Symbol('AI_PROVIDER');
