import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Machine } from '@lca-mes/shared';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/useAuth';
import { AppLayout } from '../components/AppLayout';

const inputClass =
  'w-full rounded-md border border-brand-border px-3 py-2.5 text-sm transition-colors focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand';

function parseFormats(value: string): number[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map(Number);
}

function formatFormats(formats: number[]): string {
  return formats.join(', ');
}

const rowClass = (active: boolean) =>
  `transition-colors odd:bg-white even:bg-gray-50/60 hover:bg-brand-bg ${active ? '' : 'opacity-50'}`;

const emptyForm = { name: '', supportedFormats: '' };

type EditForm = { name: string; supportedFormats: string };

export function MachinesPage() {
  const { token } = useAuth();

  const [machines, setMachines] = useState<Machine[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const loadMachines = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      setMachines(await api.listMachines(token));
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Impossible de charger les machines.');
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadMachines();
  }, [loadMachines]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setFormError(null);
    setIsSubmitting(true);
    try {
      await api.createMachine(token, {
        name: form.name,
        supportedFormats: parseFormats(form.supportedFormats),
      });
      setForm(emptyForm);
      await loadMachines();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Impossible de créer la machine.');
    } finally {
      setIsSubmitting(false);
    }
  }

  function startEdit(machine: Machine) {
    setEditingId(machine.id);
    setEditError(null);
    setEditForm({ name: machine.name, supportedFormats: formatFormats(machine.supportedFormats) });
  }

  async function handleSaveEdit(id: string) {
    if (!token || !editForm) return;
    setEditError(null);
    try {
      await api.updateMachine(token, id, {
        name: editForm.name,
        supportedFormats: parseFormats(editForm.supportedFormats),
      });
      setEditingId(null);
      setEditForm(null);
      await loadMachines();
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : 'Impossible de modifier cette machine.');
    }
  }

  async function handleDeactivate(machine: Machine) {
    if (!token) return;
    if (!confirm(`Désactiver "${machine.name}" ? Elle ne pourra plus être sélectionnée pour un nouveau batch.`)) {
      return;
    }
    try {
      await api.deactivateMachine(token, machine.id);
      await loadMachines();
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Impossible de désactiver cette machine.');
    }
  }

  return (
    <AppLayout>
      <h2 className="text-xl font-semibold text-gray-900">Machines</h2>
      <p className="mt-1 text-sm text-gray-500">
        Machines de conditionnement disponibles pour la production. La désactivation préserve l'historique des
        batchs déjà réalisés.
      </p>

      <div className="mt-6 rounded-xl border border-brand-border bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold text-gray-900">Créer une machine</h3>
        <form onSubmit={handleCreate} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-500">Nom</label>
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Ex : CDA E-Fill 2"
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-500">Formats supportés (ml)</label>
            <input
              required
              value={form.supportedFormats}
              onChange={(e) => setForm({ ...form, supportedFormats: e.target.value })}
              placeholder="Ex : 50, 100, 200"
              className={inputClass}
            />
          </div>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-md bg-brand px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? 'Création…' : 'Créer la machine'}
            </button>
          </div>
          {formError && (
            <p className="sm:col-span-3 text-sm text-red-600">{formError}</p>
          )}
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
                <th className="px-4 py-2 text-left font-medium text-gray-500">Formats supportés (ml)</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Statut</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {machines.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-gray-500">
                    Aucune machine. Créez-en une ci-dessus avant de pouvoir lancer un batch.
                  </td>
                </tr>
              )}
              {machines.map((machine) => {
                const isEditing = editingId === machine.id;
                return (
                  <tr key={machine.id} className={rowClass(machine.active)}>
                    {isEditing && editForm ? (
                      <>
                        <td className="px-4 py-2">
                          <input
                            value={editForm.name}
                            onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                            className="w-full rounded-md border border-brand-border px-2 py-1 text-sm transition-colors focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <input
                            value={editForm.supportedFormats}
                            onChange={(e) => setEditForm({ ...editForm, supportedFormats: e.target.value })}
                            className="w-full rounded-md border border-brand-border px-2 py-1 text-sm transition-colors focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                          />
                        </td>
                        <td className="px-4 py-2 text-gray-500">{machine.active ? 'Active' : 'Désactivée'}</td>
                        <td className="px-4 py-2 text-right whitespace-nowrap">
                          {editError && <p className="mb-1 text-xs text-red-600">{editError}</p>}
                          <button
                            onClick={() => void handleSaveEdit(machine.id)}
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
                        <td className="px-4 py-2 font-medium text-gray-900">{machine.name}</td>
                        <td className="px-4 py-2">{formatFormats(machine.supportedFormats)}</td>
                        <td className="px-4 py-2">
                          <span
                            className={
                              machine.active
                                ? 'rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700'
                                : 'rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500'
                            }
                          >
                            {machine.active ? 'Active' : 'Désactivée'}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right whitespace-nowrap">
                          <button
                            onClick={() => startEdit(machine)}
                            className="mr-3 text-xs text-brand hover:underline"
                          >
                            Modifier
                          </button>
                          {machine.active && (
                            <button
                              onClick={() => void handleDeactivate(machine)}
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
