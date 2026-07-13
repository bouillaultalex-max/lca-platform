import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Supplier } from '@lca-mes/shared';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/useAuth';
import { AppLayout } from '../components/AppLayout';

const inputClass =
  'w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500';

const emptyForm = { name: '', contactName: '', phone: '', email: '' };

type EditForm = { name: string; contactName: string; phone: string; email: string };

function toEditForm(supplier: Supplier): EditForm {
  return {
    name: supplier.name,
    contactName: supplier.contactName ?? '',
    phone: supplier.phone ?? '',
    email: supplier.email ?? '',
  };
}

export function SuppliersPage() {
  const { token } = useAuth();

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const loadSuppliers = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      setSuppliers(await api.listSuppliers(token));
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Impossible de charger les fournisseurs.');
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadSuppliers();
  }, [loadSuppliers]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setFormError(null);
    setIsSubmitting(true);
    try {
      await api.createSupplier(token, {
        name: form.name,
        contactName: form.contactName || undefined,
        phone: form.phone || undefined,
        email: form.email || undefined,
      });
      setForm(emptyForm);
      await loadSuppliers();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Impossible de créer le fournisseur.');
    } finally {
      setIsSubmitting(false);
    }
  }

  function startEdit(supplier: Supplier) {
    setEditingId(supplier.id);
    setEditError(null);
    setEditForm(toEditForm(supplier));
  }

  async function handleSaveEdit(id: string) {
    if (!token || !editForm) return;
    setEditError(null);
    try {
      await api.updateSupplier(token, id, {
        name: editForm.name,
        contactName: editForm.contactName || undefined,
        phone: editForm.phone || undefined,
        email: editForm.email || undefined,
      });
      setEditingId(null);
      setEditForm(null);
      await loadSuppliers();
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : 'Impossible de modifier ce fournisseur.');
    }
  }

  async function handleDeactivate(supplier: Supplier) {
    if (!token) return;
    if (!confirm(`Désactiver "${supplier.name}" ? Il ne pourra plus être sélectionné comme fournisseur principal.`)) {
      return;
    }
    try {
      await api.deactivateSupplier(token, supplier.id);
      await loadSuppliers();
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Impossible de désactiver ce fournisseur.');
    }
  }

  return (
    <AppLayout>
      <h2 className="text-xl font-semibold text-gray-900">Fournisseurs</h2>
      <p className="mt-1 text-sm text-gray-500">
        Fournisseurs pouvant être associés comme fournisseur principal d'une matière première. La désactivation
        préserve l'historique.
      </p>

      <div className="mt-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold text-gray-900">Créer un fournisseur</h3>
        <form onSubmit={handleCreate} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Nom</label>
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Ex : Sensient Flavors"
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Contact <span className="font-normal text-gray-400">(optionnel)</span>
            </label>
            <input
              value={form.contactName}
              onChange={(e) => setForm({ ...form, contactName: e.target.value })}
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Téléphone <span className="font-normal text-gray-400">(optionnel)</span>
            </label>
            <input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              E-mail <span className="font-normal text-gray-400">(optionnel)</span>
            </label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className={inputClass}
            />
          </div>

          <div className="sm:col-span-2 lg:col-span-4">
            {formError && <p className="mb-2 text-sm text-red-600">{formError}</p>}
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? 'Création…' : 'Créer le fournisseur'}
            </button>
          </div>
        </form>
      </div>

      <div className="mt-6 overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
        {loadError && <p className="p-4 text-sm text-red-600">{loadError}</p>}
        {isLoading ? (
          <p className="p-4 text-sm text-gray-500">Chargement…</p>
        ) : (
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Nom</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Contact</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Téléphone</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">E-mail</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Statut</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {suppliers.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                    Aucun fournisseur. Créez-en un ci-dessus avant de pouvoir l'associer à une matière première.
                  </td>
                </tr>
              )}
              {suppliers.map((supplier) => {
                const isEditing = editingId === supplier.id;
                return (
                  <tr key={supplier.id} className={supplier.active ? '' : 'opacity-50'}>
                    {isEditing && editForm ? (
                      <>
                        <td className="px-4 py-2">
                          <input
                            value={editForm.name}
                            onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                            className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <input
                            value={editForm.contactName}
                            onChange={(e) => setEditForm({ ...editForm, contactName: e.target.value })}
                            className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <input
                            value={editForm.phone}
                            onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                            className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <input
                            type="email"
                            value={editForm.email}
                            onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                            className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
                          />
                        </td>
                        <td className="px-4 py-2 text-gray-500">{supplier.active ? 'Actif' : 'Désactivé'}</td>
                        <td className="px-4 py-2 text-right whitespace-nowrap">
                          {editError && <p className="mb-1 text-xs text-red-600">{editError}</p>}
                          <button
                            onClick={() => void handleSaveEdit(supplier.id)}
                            className="mr-2 text-xs font-medium text-blue-600 hover:underline"
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
                        <td className="px-4 py-2 font-medium text-gray-900">{supplier.name}</td>
                        <td className="px-4 py-2">{supplier.contactName ?? '—'}</td>
                        <td className="px-4 py-2">{supplier.phone ?? '—'}</td>
                        <td className="px-4 py-2">{supplier.email ?? '—'}</td>
                        <td className="px-4 py-2">
                          <span
                            className={
                              supplier.active
                                ? 'rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700'
                                : 'rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500'
                            }
                          >
                            {supplier.active ? 'Actif' : 'Désactivé'}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right whitespace-nowrap">
                          <button
                            onClick={() => startEdit(supplier)}
                            className="mr-3 text-xs text-blue-600 hover:underline"
                          >
                            Modifier
                          </button>
                          {supplier.active && (
                            <button
                              onClick={() => void handleDeactivate(supplier)}
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
