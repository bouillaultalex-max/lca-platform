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
              setMessages((prev) => {
                if (pendingAssistantIdRef.current === null) {
                  const id = generateLocalId();
                  pendingAssistantIdRef.current = id;
                  return [
                    ...prev,
                    { id, role: 'ASSISTANT', content: event.delta, createdAt: new Date().toISOString() },
                  ];
                }
                return prev.map((message) =>
                  message.id === pendingAssistantIdRef.current
                    ? { ...message, content: message.content + event.delta }
                    : message,
                );
              });
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
