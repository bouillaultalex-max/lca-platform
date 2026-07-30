import { useCallback, useRef, useState } from 'react';
import type { AssistantMessage } from '@lca-mes/shared';
import { streamAssistantMessage } from '../api/assistantStream';

let localIdCounter = 0;
function generateLocalId(): string {
  localIdCounter += 1;
  return `local-${localIdCounter}-${Date.now()}`;
}

export interface UseAssistantConversationResult {
  messages: AssistantMessage[];
  isStreaming: boolean;
  error: string | null;
  sendMessage: (content: string) => void;
  cancel: () => void;
}

/**
 * Applique un chunk assistant à la liste de messages. Fonction pure (aucune
 * lecture/mutation de ref) pour rester correcte sous React.StrictMode, qui
 * peut invoquer deux fois l'updater passé à setMessages.
 */
export function accumulateAssistantChunk(
  prev: AssistantMessage[],
  assistantId: string,
  delta: string,
  createdAt: string,
  isFirstChunk: boolean,
): AssistantMessage[] {
  if (isFirstChunk) {
    return [...prev, { id: assistantId, role: 'ASSISTANT', content: delta, createdAt }];
  }
  return prev.map((message) =>
    message.id === assistantId ? { ...message, content: message.content + delta } : message,
  );
}

/**
 * État d'une conversation avec l'assistant (AI-02, infrastructure uniquement) :
 * garde les messages en mémoire côté client pour la session courante — aucune
 * relecture d'historique depuis le serveur pour l'instant (pas d'endpoint de
 * liste/relecture des conversations en AI-02, voir AI-01 §11).
 */
export function useAssistantConversation(token: string | null): UseAssistantConversationResult {
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const conversationIdRef = useRef<string | undefined>(undefined);
  const abortControllerRef = useRef<AbortController | null>(null);
  const pendingAssistantIdRef = useRef<string | null>(null);

  const sendMessage = useCallback(
    (content: string) => {
      const trimmed = content.trim();
      if (!token || !trimmed || isStreaming) return;

      setError(null);
      setMessages((prev) => [
        ...prev,
        { id: generateLocalId(), role: 'USER', content: trimmed, createdAt: new Date().toISOString() },
      ]);
      setIsStreaming(true);
      pendingAssistantIdRef.current = null;

      const controller = new AbortController();
      abortControllerRef.current = controller;

      streamAssistantMessage(
        token,
        { conversationId: conversationIdRef.current, content: trimmed },
        {
          onEvent: (event) => {
            if (event.type === 'conversation') {
              conversationIdRef.current = event.conversationId;
            } else if (event.type === 'chunk') {
              // isFirstChunk/assistantId calculés hors de l'updater : la ref
              // ne doit être lue/mutée qu'une fois par chunk réel, pas par
              // invocation de l'updater (StrictMode).
              const isFirstChunk = pendingAssistantIdRef.current === null;
              const assistantId: string = pendingAssistantIdRef.current ?? generateLocalId();
              if (isFirstChunk) pendingAssistantIdRef.current = assistantId;
              const createdAt = new Date().toISOString();
              const { delta } = event;

              setMessages((prev) => accumulateAssistantChunk(prev, assistantId, delta, createdAt, isFirstChunk));
            } else if (event.type === 'error') {
              setError(event.message);
            }
          },
          onError: (message) => {
            setError(message);
            setIsStreaming(false);
          },
          onComplete: () => {
            setIsStreaming(false);
            pendingAssistantIdRef.current = null;
          },
        },
        controller.signal,
      );
    },
    [token, isStreaming],
  );

  const cancel = useCallback(() => {
    abortControllerRef.current?.abort();
    setIsStreaming(false);
    pendingAssistantIdRef.current = null;
  }, []);

  return { messages, isStreaming, error, sendMessage, cancel };
}
