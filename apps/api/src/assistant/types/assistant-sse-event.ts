/**
 * Événements du flux SSE renvoyés par POST /assistant/messages. Chaque frame SSE
 * transporte un seul de ces objets en JSON (voir AssistantController) : le type
 * est porté par le champ `type`, jamais par le champ `event:` de la trame SSE,
 * pour garder un unique format à parser côté client (voir AI-01 §16).
 *
 * `tool_call`/`tool_result` (AI-04) : signalent qu'un outil métier a été appelé
 * par l'assistant et son issue (succès/échec), jamais son résultat ni ses
 * paramètres (voir ToolCallingOrchestrator — ToolResult reste strictement
 * éphémère). Le frontend actuel les ignore sans erreur (voir
 * useAssistantConversation.ts) : uniquement une stabilisation du protocole.
 *
 * Miroir manuel de packages/shared/src/types/assistant.ts (convention déjà en
 * place dans ce dépôt entre les DTO/types backend et les types partagés
 * consommés par le frontend — voir ex. Feedback/FeedbackDto) : ne pas fusionner.
 */
export type AssistantSseEvent =
  | { type: 'conversation'; conversationId: string }
  | { type: 'chunk'; delta: string }
  | { type: 'tool_call'; name: string }
  | { type: 'tool_result'; name: string; success: boolean }
  | { type: 'done' }
  | { type: 'error'; message: string };
