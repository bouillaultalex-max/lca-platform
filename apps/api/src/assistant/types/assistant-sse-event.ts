/**
 * Événements du flux SSE renvoyés par POST /assistant/messages. Chaque frame SSE
 * transporte un seul de ces objets en JSON (voir AssistantController) : le type
 * est porté par le champ `type`, jamais par le champ `event:` de la trame SSE,
 * pour garder un unique format à parser côté client (voir AI-01 §16).
 *
 * Miroir manuel de packages/shared/src/types/assistant.ts (convention déjà en
 * place dans ce dépôt entre les DTO/types backend et les types partagés
 * consommés par le frontend — voir ex. Feedback/FeedbackDto) : ne pas fusionner.
 */
export type AssistantSseEvent =
  | { type: 'conversation'; conversationId: string }
  | { type: 'chunk'; delta: string }
  | { type: 'done' }
  | { type: 'error'; message: string };
