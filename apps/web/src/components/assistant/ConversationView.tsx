import { useEffect, useRef } from 'react';
import type { AssistantMessage } from '@lca-mes/shared';
import { MessageBubble } from './MessageBubble';

/**
 * `aria-live="polite"` : annonce les nouveaux messages (utilisateur et
 * assistant, fragment par fragment) sans interrompre un lecteur d'écran en
 * cours d'énonciation — voir AI-01 §15 (annonces de nouveaux messages).
 */
export function ConversationView({ messages }: { messages: AssistantMessage[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  return (
    <div aria-live="polite" className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
      {messages.length === 0 ? (
        <p className="text-sm text-gray-500">
          Posez une question sur le tableau de bord, les stocks, la traçabilité, la production ou
          les imports. L'assistant consulte les données disponibles en lecture seule et ne peut
          effectuer aucune modification.
        </p>
      ) : (
        messages.map((message) => <MessageBubble key={message.id} message={message} />)
      )}
      <div ref={bottomRef} />
    </div>
  );
}
