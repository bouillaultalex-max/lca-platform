/**
 * Assistant IA (AI-01/AI-02) — infrastructure uniquement : aucun outil métier,
 * aucune action, aucune confirmation à ce stade (voir docs/roadmap.md).
 *
 * Miroir manuel de apps/api/src/assistant/types/assistant-sse-event.ts (même
 * convention que le reste du dépôt entre types backend et types partagés —
 * voir ex. Feedback/CreateFeedbackDto) : ne pas fusionner les deux fichiers.
 */

export type AssistantMessageRole = 'USER' | 'ASSISTANT';

export interface AssistantMessage {
  id: string;
  role: AssistantMessageRole;
  content: string;
  createdAt: string;
}

export interface SendAssistantMessageRequest {
  /** Absent pour démarrer une nouvelle conversation. */
  conversationId?: string;
  content: string;
}

/**
 * Événements du flux SSE reçus par le frontend (voir api/assistantStream.ts).
 * Le type est toujours porté par le champ `type`, jamais par le champ `event:`
 * de la trame SSE elle-même (un seul format à parser).
 *
 * `tool_call`/`tool_result` (AI-04) : un outil métier a été appelé et son
 * issue (succès/échec) — jamais son résultat ni ses paramètres. Le frontend
 * actuel les ignore sans erreur (voir useAssistantConversation.ts) : ajoutés
 * ici uniquement pour stabiliser le protocole, aucun traitement visuel pour
 * l'instant.
 */
export type AssistantSseEvent =
  | { type: 'conversation'; conversationId: string }
  | { type: 'chunk'; delta: string }
  | { type: 'tool_call'; name: string }
  | { type: 'tool_result'; name: string; success: boolean }
  | { type: 'done' }
  | { type: 'error'; message: string };
