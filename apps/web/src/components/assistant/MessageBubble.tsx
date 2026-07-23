import type { AssistantMessage } from '@lca-mes/shared';

export function MessageBubble({ message }: { message: AssistantMessage }) {
  const isUser = message.role === 'USER';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <p
        className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
          isUser ? 'bg-navy text-white' : 'bg-surface-muted text-gray-900'
        }`}
      >
        {message.content}
      </p>
    </div>
  );
}
