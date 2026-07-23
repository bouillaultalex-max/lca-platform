import { useEffect, useRef } from 'react';
import { useAuth } from '../../auth/useAuth';
import { useAssistantConversation } from '../../hooks/useAssistantConversation';
import { ConversationView } from './ConversationView';
import { Composer } from './Composer';

/**
 * Panneau latéral de l'assistant (AI-02, implémentation minimale — voir
 * AI-01 §15 : bouton + panneau + historique). Reste monté en permanence
 * (translation CSS plutôt que montage conditionnel, même principe que la
 * Sidebar mobile — voir Sidebar.tsx) et utilise `inert` quand fermé, pour
 * retirer le panneau du clavier et des lecteurs d'écran sans perdre son état.
 *
 * Accessibilité minimale prévue dès cette infrastructure :
 * - le focus se déplace sur le bouton de fermeture à l'ouverture ;
 * - il revient sur l'élément précédemment focus (le bouton d'ouverture) à la fermeture ;
 * - Échap ferme le panneau ;
 * - `role="dialog"`/`aria-modal`/`aria-label` identifient le panneau.
 */
export function AssistantPanel({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { token } = useAuth();
  const { messages, isStreaming, error, sendMessage, cancel } = useAssistantConversation(token);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
      closeButtonRef.current?.focus();
    } else {
      previouslyFocusedRef.current?.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Assistant"
        inert={!isOpen}
        className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col border-l border-divider bg-white shadow-xl transition-transform duration-200 motion-reduce:transition-none ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex h-[var(--header-height)] shrink-0 items-center justify-between border-b border-divider px-4">
          <p className="text-sm font-semibold text-gray-900">Assistant</p>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Fermer l'assistant"
            className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
          >
            ✕
          </button>
        </div>

        <ConversationView messages={messages} />

        {error && (
          <p role="alert" className="border-t border-divider px-4 py-2 text-sm text-red-600">
            {error}
          </p>
        )}

        <Composer isStreaming={isStreaming} onSend={sendMessage} onCancel={cancel} />
      </div>
    </>
  );
}
