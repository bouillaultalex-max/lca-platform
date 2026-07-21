import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { ProductFamily } from '@lca-mes/shared';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/useAuth';
import { AppLayout } from '../components/AppLayout';

const inputClass =
  'w-full rounded-md border border-brand-border px-3 py-2.5 text-sm transition-colors focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand';

const rowClass = (active: boolean) =>
  `transition-colors odd:bg-white even:bg-gray-50/60 hover:bg-brand-bg ${active ? '' : 'opacity-50'}`;

const emptyForm = { name: '' };

type EditForm = { name: string };

function toEditForm(productFamily: ProductFamily): EditForm {
  return { name: productFamily.name };
}

export function ProductFamiliesPage() {
  const { token } = useAuth();

  const [productFamilies, setProductFamilies] = useState<ProductFamily[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const loadProductFamilies = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      setProductFamilies(await api.listProductFamilies(token));
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Impossible de charger les familles commerciales.');
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadProductFamilies();
  }, [loadProductFamilies]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setFormError(null);
    setIsSubmitting(true);
    try {
      await api.createProductFamily(token, { name: form.name });
      setForm(emptyForm);
      await loadProductFamilies();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Impossible de créer la famille commerciale.');
    } finally {
      setIsSubmitting(false);
    }
  }

  function startEdit(productFamily: ProductFamily) {
    setEditingId(productFamily.id);
    setEditError(null);
    setEditForm(toEditForm(productFamily));
  }

  async function handleSaveEdit(id: string) {
    if (!token || !editForm) return;
    setEditError(null);
    try {
      await api.updateProductFamily(token, id, { name: editForm.name });
      setEditingId(null);
      setEditForm(null);
      await loadProductFamilies();
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : 'Impossible de modifier cette famille commerciale.');
    }
  }

  async function handleDeactivate(productFamily: ProductFamily) {
    if (!token) return;
    if (
      !confirm(
        `Désactiver la famille commerciale "${productFamily.name}" ? Elle ne pourra plus être associée à un produit fini.`,
      )
    ) {
      return;
    }
    try {
      await api.deactivateProductFamily(token, productFamily.id);
      await loadProductFamilies();
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Impossible de désactiver cette famille commerciale.');
    }
  }

  return (
    <AppLayout>
      <h2 className="text-xl font-semibold text-gray-900">Familles de produits</h2>
      <p className="mt-1 text-sm text-gray-500">
        Regroupent les déclinaisons commerciales d'un même produit par marché (ex. "Recharge Lavande" → France,
        Suisse). La désactivation préserve l'historique.
      </p>

      <div className="mt-6 rounded-xl border border-brand-border bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold text-gray-900">Créer une famille commerciale</h3>
        <form onSubmit={handleCreate} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-500">Nom</label>
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Ex : Recharge Lavande"
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
              {isSubmitting ? 'Création…' : 'Créer la famille'}
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
                <th className="px-4 py-2 text-left font-medium text-gray-500">Nom</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Statut</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {productFamilies.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-gray-500">
                    Aucune famille commerciale. Créez-en une ci-dessus avant de pouvoir l'associer à un produit fini.
                  </td>
                </tr>
              )}
              {productFamilies.map((productFamily) => {
                const isEditing = editingId === productFamily.id;
                return (
                  <tr key={productFamily.id} className={rowClass(productFamily.active)}>
                    {isEditing && editForm ? (
                      <>
                        <td className="px-4 py-2">
                          <input
                            value={editForm.name}
                            onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                            className="w-full rounded-md border border-brand-border px-2 py-1 text-sm transition-colors focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                          />
                        </td>
                        <td className="px-4 py-2 text-gray-500">{productFamily.active ? 'Actif' : 'Désactivé'}</td>
                        <td className="px-4 py-2 text-right whitespace-nowrap">
                          {editError && <p className="mb-1 text-xs text-red-600">{editError}</p>}
                          <button
                            onClick={() => void handleSaveEdit(productFamily.id)}
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
                        <td className="px-4 py-2 font-medium text-gray-900">{productFamily.name}</td>
                        <td className="px-4 py-2">
                          <span
                            className={
                              productFamily.active
                                ? 'rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700'
                                : 'rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500'
                            }
                          >
                            {productFamily.active ? 'Actif' : 'Désactivé'}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right whitespace-nowrap">
                          <button
                            onClick={() => startEdit(productFamily)}
                            className="mr-3 text-xs text-brand hover:underline"
                          >
                            Modifier
                          </button>
                          {productFamily.active && (
                            <button
                              onClick={() => void handleDeactivate(productFamily)}
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
