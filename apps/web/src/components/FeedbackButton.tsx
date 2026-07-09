import { useState, type FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import {
  FEEDBACK_TYPE_LABELS,
  FEEDBACK_PRIORITY_LABELS,
  type FeedbackType,
  type FeedbackPriority,
} from '@lca-mes/shared';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/useAuth';
import { Modal } from './Modal';

const FEEDBACK_TYPES: FeedbackType[] = ['BUG', 'IDEE', 'AMELIORATION', 'QUESTION'];
const FEEDBACK_PRIORITIES: FeedbackPriority[] = ['NORMALE', 'IMPORTANTE', 'BLOQUANTE'];

const inputClass =
  'w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500';

export function FeedbackButton() {
  const { token } = useAuth();
  const location = useLocation();

  const [isOpen, setIsOpen] = useState(false);
  const [type, setType] = useState<FeedbackType>('BUG');
  const [priority, setPriority] = useState<FeedbackPriority>('NORMALE');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSent, setIsSent] = useState(false);

  function reset() {
    setType('BUG');
    setPriority('NORMALE');
    setMessage('');
    setError(null);
    setIsSent(false);
  }

  function handleClose() {
    setIsOpen(false);
    reset();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setError(null);
    setIsSubmitting(true);
    try {
      await api.createFeedback(token, {
        type,
        priority,
        message,
        pageUrl: location.pathname,
      });
      setIsSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible d’envoyer ce retour.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 transition hover:bg-gray-100"
      >
        💡 Faire un retour
      </button>

      {isOpen && (
        <Modal title="Faire un retour" onClose={handleClose}>
          {isSent ? (
            <div className="space-y-4">
              <p className="text-sm text-gray-700">Merci, votre retour a été enregistré.</p>
              <button
                onClick={handleClose}
                className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
              >
                Fermer
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Type</label>
                <select value={type} onChange={(e) => setType(e.target.value as FeedbackType)} className={inputClass}>
                  {FEEDBACK_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {FEEDBACK_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Priorité</label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as FeedbackPriority)}
                  className={inputClass}
                >
                  {FEEDBACK_PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {FEEDBACK_PRIORITY_LABELS[p]}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Message</label>
                <textarea
                  required
                  rows={4}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Décrivez le bug, l'idée, l'amélioration ou la question..."
                  className={inputClass}
                />
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? 'Envoi…' : 'Envoyer'}
              </button>
            </form>
          )}
        </Modal>
      )}
    </>
  );
}
