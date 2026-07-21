import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Market } from '@lca-mes/shared';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/useAuth';
import { AppLayout } from '../components/AppLayout';

const inputClass =
  'w-full rounded-md border border-brand-border px-3 py-2.5 text-sm transition-colors focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand';

const rowClass = (active: boolean) =>
  `transition-colors odd:bg-white even:bg-gray-50/60 hover:bg-brand-bg ${active ? '' : 'opacity-50'}`;

const emptyForm = { code: '', label: '' };

type EditForm = { code: string; label: string };

function toEditForm(market: Market): EditForm {
  return { code: market.code, label: market.label };
}

export function MarketsPage() {
  const { token } = useAuth();

  const [markets, setMarkets] = useState<Market[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const loadMarkets = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      setMarkets(await api.listMarkets(token));
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Impossible de charger les marchés.');
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadMarkets();
  }, [loadMarkets]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setFormError(null);
    setIsSubmitting(true);
    try {
      await api.createMarket(token, { code: form.code, label: form.label });
      setForm(emptyForm);
      await loadMarkets();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Impossible de créer le marché.');
    } finally {
      setIsSubmitting(false);
    }
  }

  function startEdit(market: Market) {
    setEditingId(market.id);
    setEditError(null);
    setEditForm(toEditForm(market));
  }

  async function handleSaveEdit(id: string) {
    if (!token || !editForm) return;
    setEditError(null);
    try {
      await api.updateMarket(token, id, { code: editForm.code, label: editForm.label });
      setEditingId(null);
      setEditForm(null);
      await loadMarkets();
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : 'Impossible de modifier ce marché.');
    }
  }

  async function handleDeactivate(market: Market) {
    if (!token) return;
    if (!confirm(`Désactiver le marché "${market.label}" ? Il ne pourra plus être associé à un produit fini.`)) {
      return;
    }
    try {
      await api.deactivateMarket(token, market.id);
      await loadMarkets();
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Impossible de désactiver ce marché.');
    }
  }

  return (
    <AppLayout>
      <h2 className="text-xl font-semibold text-gray-900">Marchés</h2>
      <p className="mt-1 text-sm text-gray-500">
        Destinations commerciales ou réglementaires (ex. France, Suisse) pouvant être associées à un produit fini.
        La désactivation préserve l'historique.
      </p>

      <div className="mt-6 rounded-xl border border-brand-border bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold text-gray-900">Créer un marché</h3>
        <form onSubmit={handleCreate} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-500">Code</label>
            <input
              required
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              placeholder="Ex : FR"
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-500">Libellé</label>
            <input
              required
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder="Ex : France"
              className={inputClass}
            />
          </div>

          <div className="sm:col-span-2 lg:col-span-4">
            {formError && <p className="mb-2 text-sm text-red-600">{formError}</p>}
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-md bg-brand px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? 'Création…' : 'Créer le marché'}
            </button>
          </div>
        </form>
      </div>

      <div className="mt-6 overflow-x-auto rounded-xl border border-brand-border bg-white shadow-sm">
        {loadError && <p className="p-4 text-sm text-red-600">{loadError}</p>}
        {isLoading ? (
          <p className="p-4 text-sm text-gray-500">Chargement…</p>
        ) : (
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Code</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Libellé</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Statut</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {markets.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-gray-500">
                    Aucun marché. Créez-en un ci-dessus avant de pouvoir l'associer à un produit fini.
                  </td>
                </tr>
              )}
              {markets.map((market) => {
                const isEditing = editingId === market.id;
                return (
                  <tr key={market.id} className={rowClass(market.active)}>
                    {isEditing && editForm ? (
                      <>
                        <td className="px-4 py-2">
                          <input
                            value={editForm.code}
                            onChange={(e) => setEditForm({ ...editForm, code: e.target.value })}
                            className="w-full rounded-md border border-brand-border px-2 py-1 text-sm transition-colors focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <input
                            value={editForm.label}
                            onChange={(e) => setEditForm({ ...editForm, label: e.target.value })}
                            className="w-full rounded-md border border-brand-border px-2 py-1 text-sm transition-colors focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                          />
                        </td>
                        <td className="px-4 py-2 text-gray-500">{market.active ? 'Actif' : 'Désactivé'}</td>
                        <td className="px-4 py-2 text-right whitespace-nowrap">
                          {editError && <p className="mb-1 text-xs text-red-600">{editError}</p>}
                          <button
                            onClick={() => void handleSaveEdit(market.id)}
                            className="mr-2 text-xs font-medium text-brand hover:underline"
                          >
                            Enregistrer
                          </button>
                          <button
                            onClick={() => {
                              setEditingId(null);
                              setEditForm(null);
                            }}
                            className="text-xs text-gray-500 hover:underline"
                          >
                            Annuler
                          </button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-2 font-mono text-xs">{market.code}</td>
                        <td className="px-4 py-2 font-medium text-gray-900">{market.label}</td>
                        <td className="px-4 py-2">
                          <span
                            className={
                              market.active
                                ? 'rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700'
                                : 'rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500'
                            }
                          >
                            {market.active ? 'Actif' : 'Désactivé'}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right whitespace-nowrap">
                          <button onClick={() => startEdit(market)} className="mr-3 text-xs text-brand hover:underline">
                            Modifier
                          </button>
                          {market.active && (
                            <button
                              onClick={() => void handleDeactivate(market)}
                              className="text-xs text-red-600 hover:underline"
                            >
                              Désactiver
                            </button>
                          )}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </AppLayout>
  );
}
