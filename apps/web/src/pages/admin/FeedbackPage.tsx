import { useCallback, useEffect, useState } from 'react';
import {
  FEEDBACK_TYPE_LABELS,
  FEEDBACK_PRIORITY_LABELS,
  type Feedback,
} from '@lca-mes/shared';
import { api, ApiError } from '../../api/client';
import { useAuth } from '../../auth/useAuth';
import { AppLayout } from '../../components/AppLayout';

function formatDate(value: string): string {
  return new Date(value).toLocaleString('fr-FR');
}

const priorityBadgeClass: Record<string, string> = {
  NORMALE: 'bg-gray-100 text-gray-600',
  IMPORTANTE: 'bg-amber-50 text-amber-700',
  BLOQUANTE: 'bg-red-50 text-red-700',
};

const rowClass = (treated: boolean) =>
  `transition-colors odd:bg-white even:bg-gray-50/60 hover:bg-brand-bg ${treated ? 'opacity-60' : ''}`;

export function FeedbackPage() {
  const { token } = useAuth();
  const [entries, setEntries] = useState<Feedback[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      setEntries(await api.listFeedback(token));
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Impossible de charger les retours.');
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleMarkAsTreated(feedback: Feedback) {
    if (!token) return;
    try {
      await api.markFeedbackAsTreated(token, feedback.id);
      await load();
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Impossible de marquer ce retour comme traité.');
    }
  }

  return (
    <AppLayout>
      <h2 className="text-xl font-semibold text-gray-900">Retours utilisateurs</h2>
      <p className="mt-1 text-sm text-gray-500">
        Bugs, idées, améliorations et questions signalés pendant les tests. Journal simple : pas de commentaires,
        pas d'assignation.
      </p>

      <div className="mt-6 overflow-x-auto rounded-xl border border-brand-border bg-white shadow-sm">
        {loadError && <p className="p-4 text-sm text-red-600">{loadError}</p>}
        {isLoading ? (
          <p className="p-4 text-sm text-gray-500">Chargement…</p>
        ) : (
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Date</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Utilisateur</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Type</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Priorité</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Page</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Message</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Version</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Statut</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {entries.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-gray-500">
                    Aucun retour pour le moment.
                  </td>
                </tr>
              )}
              {entries.map((entry) => (
                <tr key={entry.id} className={rowClass(entry.status === 'TRAITE')}>
                  <td className="px-4 py-2 whitespace-nowrap text-gray-500">{formatDate(entry.createdAt)}</td>
                  <td className="px-4 py-2">{entry.user.fullName}</td>
                  <td className="px-4 py-2">{FEEDBACK_TYPE_LABELS[entry.type]}</td>
                  <td className="px-4 py-2">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${priorityBadgeClass[entry.priority]}`}>
                      {FEEDBACK_PRIORITY_LABELS[entry.priority]}
                    </span>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">{entry.pageUrl}</td>
                  <td className="max-w-sm px-4 py-2">{entry.message}</td>
                  <td className="px-4 py-2 text-xs text-gray-500">{entry.appVersion}</td>
                  <td className="px-4 py-2">
                    <span
                      className={
                        entry.status === 'NOUVEAU'
                          ? 'rounded-full bg-brand/10 px-2.5 py-0.5 text-xs font-medium text-brand'
                          : 'rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700'
                      }
                    >
                      {entry.status === 'NOUVEAU' ? 'Nouveau' : 'Traité'}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    {entry.status === 'NOUVEAU' && (
                      <button
                        onClick={() => void handleMarkAsTreated(entry)}
                        className="text-xs text-brand hover:underline"
                      >
                        Marquer comme traité
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </AppLayout>
  );
}
