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
 */
export type AssistantSseEvent =
  | { type: 'conversation'; conversationId: string }
  | { type: 'chunk'; delta: string }
  | { type: 'done' }
  | { type: 'error'; message: string };
