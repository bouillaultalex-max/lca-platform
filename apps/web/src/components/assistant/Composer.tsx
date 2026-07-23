import { useState, type FormEvent, type KeyboardEvent } from 'react';

export function Composer({
  isStreaming,
  onSend,
  onCancel,
}: {
  isStreaming: boolean;
  onSend: (content: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState('');

  function submit() {
    const trimmed = value.trim();
    if (!trimmed || isStreaming) return;
    onSend(trimmed);
    setValue('');
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submit();
  }

  // Entrée envoie, Maj+Entrée insère un retour à la ligne — convention de
  // saisie clavier standard d'un composeur de discussion.
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-2 border-t border-divider p-3">
      <label htmlFor="assistant-composer" className="sr-only">
        Message à l'assistant
      </label>
      <textarea
        id="assistant-composer"
        rows={2}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Écrivez un message..."
        disabled={isStreaming}
        className="w-full flex-1 resize-none rounded-md border border-divider px-3 py-2 text-sm transition-colors focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:cursor-not-allowed disabled:opacity-60"
      />
      {isStreaming ? (
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-divider px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
        >
          Arrêter
        </button>
      ) : (
        <button
          type="submit"
          disabled={!value.trim()}
          className="rounded-md bg-navy px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:cursor-not-allowed disabled:opacity-60"
        >
          Envoyer
        </button>
      )}
    </form>
  );
}
