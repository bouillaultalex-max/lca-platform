import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { ARTICLE_TYPE_LABELS, type Article, type ArticleType, type Supplier } from '@lca-mes/shared';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/useAuth';
import { AppLayout } from '../components/AppLayout';

const ARTICLE_TYPES: ArticleType[] = ['MATIERE_PREMIERE', 'PACKAGING', 'PRODUIT_FINI'];

/**
 * Fournisseur principal autorisé pour les matières premières et le packaging,
 * jamais pour un produit fini (retour Kevin : le laboratoire gère aussi les
 * commandes de packaging) — voir la même règle côté ArticlesService.
 */
function canHaveSupplier(type: ArticleType): boolean {
  return type === 'MATIERE_PREMIERE' || type === 'PACKAGING';
}

const inputClass =
  'w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500';

const emptyForm = {
  type: 'MATIERE_PREMIERE' as ArticleType,
  openSiReference: '',
  name: '',
  unitOfMeasure: '',
  currentUnitCost: '',
  unitsPerCarton: '',
  densityKgPerL: '',
  supplierId: '',
};

type EditForm = {
  type: ArticleType;
  openSiReference: string;
  name: string;
  unitOfMeasure: string;
  currentUnitCost: string;
  unitsPerCarton: string;
  densityKgPerL: string;
  supplierId: string;
};

function toEditForm(article: Article): EditForm {
  return {
    type: article.type,
    openSiReference: article.openSiReference,
    name: article.name,
    unitOfMeasure: article.unitOfMeasure,
    currentUnitCost: String(article.currentUnitCost),
    unitsPerCarton: article.unitsPerCarton === null ? '' : String(article.unitsPerCarton),
    densityKgPerL: article.densityKgPerL === null ? '' : String(article.densityKgPerL),
    supplierId: article.supplierId ?? '',
  };
}

export function CatalogPage() {
  const { token } = useAuth();
  const [articles, setArticles] = useState<Article[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [filterType, setFilterType] = useState<ArticleType | ''>('');
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const loadArticles = useCallback(
    async (type?: ArticleType) => {
      if (!token) return;
      setIsLoading(true);
      setLoadError(null);
      try {
        setArticles(await api.listArticles(token, type || undefined));
      } catch (err) {
        setLoadError(err instanceof ApiError ? err.message : 'Impossible de charger les articles.');
      } finally {
        setIsLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    void loadArticles(filterType || undefined);
  }, [loadArticles, filterType]);

  useEffect(() => {
    if (!token) return;
    api
      .listSuppliers(token)
      .then(setSuppliers)
      .catch(() => {
        /* Non bloquant : le tableau affichera simplement "—" si la liste échoue à charger. */
      });
  }, [token]);

  const supplierById = useMemo(() => new Map(suppliers.map((supplier) => [supplier.id, supplier])), [suppliers]);
  const activeSuppliers = useMemo(() => suppliers.filter((supplier) => supplier.active), [suppliers]);

  const filteredArticles = useMemo(() => {
    const searchLower = search.trim().toLowerCase();
    if (!searchLower) return articles;
    return articles.filter(
      (article) =>
        article.name.toLowerCase().includes(searchLower) ||
        article.openSiReference.toLowerCase().includes(searchLower),
    );
  }, [articles, search]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setFormError(null);
    setIsSubmitting(true);
    try {
      await api.createArticle(token, {
        type: form.type,
        openSiReference: form.openSiReference,
        name: form.name,
        unitOfMeasure: form.unitOfMeasure,
        currentUnitCost: Number(form.currentUnitCost),
        unitsPerCarton: form.unitsPerCarton ? Number(form.unitsPerCarton) : undefined,
        densityKgPerL: form.densityKgPerL ? Number(form.densityKgPerL) : undefined,
        supplierId: canHaveSupplier(form.type) && form.supplierId ? form.supplierId : undefined,
      });
      setForm(emptyForm);
      await loadArticles(filterType || undefined);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Impossible de créer l’article.');
    } finally {
      setIsSubmitting(false);
    }
  }

  function startEdit(article: Article) {
    setEditingId(article.id);
    setEditError(null);
    setEditForm(toEditForm(article));
  }

  async function handleSaveEdit(id: string) {
    if (!token || !editForm) return;
    setEditError(null);
    try {
      await api.updateArticle(token, id, {
        type: editForm.type,
        openSiReference: editForm.openSiReference,
        name: editForm.name,
        unitOfMeasure: editForm.unitOfMeasure,
        currentUnitCost: Number(editForm.currentUnitCost),
        unitsPerCarton: editForm.unitsPerCarton ? Number(editForm.unitsPerCarton) : undefined,
        densityKgPerL: editForm.densityKgPerL ? Number(editForm.densityKgPerL) : undefined,
        supplierId: canHaveSupplier(editForm.type) && editForm.supplierId ? editForm.supplierId : undefined,
      });
      setEditingId(null);
      setEditForm(null);
      await loadArticles(filterType || undefined);
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : 'Impossible de modifier cet article.');
    }
  }

  async function handleDeactivate(article: Article) {
    if (!token) return;
    if (!confirm(`Désactiver "${article.name}" ? Il ne pourra plus être utilisé dans une nouvelle recette.`)) {
      return;
    }
    try {
      await api.deactivateArticle(token, article.id);
      await loadArticles(filterType || undefined);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Impossible de désactiver l’article.');
    }
  }

  return (
    <AppLayout>
      <h2 className="text-xl font-semibold text-gray-900">Catalogue</h2>
      <p className="mt-1 text-sm text-gray-500">
        Matières premières, packaging et produits finis. La désactivation préserve l’historique (recettes,
        stock, lots) sans suppression physique.
      </p>

      <div className="mt-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold text-gray-900">Créer un article</h3>
        <form onSubmit={handleCreate} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Type</label>
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as ArticleType })}
              className={inputClass}
            >
              {ARTICLE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {ARTICLE_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Référence OpenSi</label>
            <input
              required
              value={form.openSiReference}
              onChange={(e) => setForm({ ...form, openSiReference: e.target.value })}
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Désignation</label>
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Unité</label>
            <input
              required
              placeholder="L, kg, unité..."
              value={form.unitOfMeasure}
              onChange={(e) => setForm({ ...form, unitOfMeasure: e.target.value })}
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Coût unitaire</label>
            <input
              required
              type="number"
              min="0"
              step="0.0001"
              value={form.currentUnitCost}
              onChange={(e) => setForm({ ...form, currentUnitCost: e.target.value })}
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Unités par carton <span className="font-normal text-gray-400">(optionnel)</span>
            </label>
            <input
              type="number"
              min="1"
              step="1"
              placeholder="Ex : 100"
              value={form.unitsPerCarton}
              onChange={(e) => setForm({ ...form, unitsPerCarton: e.target.value })}
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Densité, kg/L <span className="font-normal text-gray-400">(matières premières, optionnel)</span>
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="Ex : 0.98"
              value={form.densityKgPerL}
              onChange={(e) => setForm({ ...form, densityKgPerL: e.target.value })}
              className={inputClass}
            />
          </div>
          {canHaveSupplier(form.type) && (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Fournisseur principal <span className="font-normal text-gray-400">(optionnel)</span>
              </label>
              <select
                value={form.supplierId}
                onChange={(e) => setForm({ ...form, supplierId: e.target.value })}
                className={inputClass}
              >
                <option value="">Aucun</option>
                {activeSuppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="sm:col-span-2 lg:col-span-4">
            {formError && <p className="mb-2 text-sm text-red-600">{formError}</p>}
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? 'Création…' : 'Créer l’article'}
            </button>
          </div>
        </form>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <input
          placeholder="Rechercher (désignation, référence)..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={`${inputClass} max-w-xs`}
        />
        <label className="text-sm font-medium text-gray-700">Filtrer par type :</label>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value as ArticleType | '')}
          className={`${inputClass} w-auto`}
        >
          <option value="">Tous</option>
          {ARTICLE_TYPES.map((type) => (
            <option key={type} value={type}>
              {ARTICLE_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
        {loadError && <p className="p-4 text-sm text-red-600">{loadError}</p>}
        {isLoading ? (
          <p className="p-4 text-sm text-gray-500">Chargement…</p>
        ) : (
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Type</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Référence</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Désignation</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Unité</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Coût unitaire</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Unités/carton</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Densité kg/L</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Fournisseur</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Statut</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredArticles.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-6 text-center text-gray-500">
                    Aucun article.
                  </td>
                </tr>
              )}
              {filteredArticles.map((article) => {
                const isEditing = editingId === article.id;
                return (
                  <tr key={article.id} className={article.active ? '' : 'opacity-50'}>
                    {isEditing && editForm ? (
                      <>
                        <td className="px-4 py-2">
                          <select
                            value={editForm.type}
                            onChange={(e) => setEditForm({ ...editForm, type: e.target.value as ArticleType })}
                            className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
                          >
                            {ARTICLE_TYPES.map((type) => (
                              <option key={type} value={type}>
                                {ARTICLE_TYPE_LABELS[type]}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-2">
                          <input
                            value={editForm.openSiReference}
                            onChange={(e) => setEditForm({ ...editForm, openSiReference: e.target.value })}
                            className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <input
                            value={editForm.name}
                            onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                            className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <input
                            value={editForm.unitOfMeasure}
                            onChange={(e) => setEditForm({ ...editForm, unitOfMeasure: e.target.value })}
                            className="w-20 rounded-md border border-gray-300 px-2 py-1 text-sm"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <input
                            type="number"
                            min="0"
                            step="0.0001"
                            value={editForm.currentUnitCost}
                            onChange={(e) => setEditForm({ ...editForm, currentUnitCost: e.target.value })}
                            className="w-24 rounded-md border border-gray-300 px-2 py-1 text-sm"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={editForm.unitsPerCarton}
                            onChange={(e) => setEditForm({ ...editForm, unitsPerCarton: e.target.value })}
                            className="w-20 rounded-md border border-gray-300 px-2 py-1 text-sm"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={editForm.densityKgPerL}
                            onChange={(e) => setEditForm({ ...editForm, densityKgPerL: e.target.value })}
                            className="w-20 rounded-md border border-gray-300 px-2 py-1 text-sm"
                          />
                        </td>
                        <td className="px-4 py-2">
                          {canHaveSupplier(editForm.type) ? (
                            <select
                              value={editForm.supplierId}
                              onChange={(e) => setEditForm({ ...editForm, supplierId: e.target.value })}
                              className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
                            >
                              <option value="">Aucun</option>
                              {activeSuppliers.map((supplier) => (
                                <option key={supplier.id} value={supplier.id}>
                                  {supplier.name}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-gray-500">{article.active ? 'Actif' : 'Désactivé'}</td>
                        <td className="px-4 py-2 text-right whitespace-nowrap">
                          {editError && <p className="mb-1 text-xs text-red-600">{editError}</p>}
                          <button
                            onClick={() => void handleSaveEdit(article.id)}
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
                        <td className="px-4 py-2">{ARTICLE_TYPE_LABELS[article.type]}</td>
                        <td className="px-4 py-2 font-mono text-xs">{article.openSiReference}</td>
                        <td className="px-4 py-2">{article.name}</td>
                        <td className="px-4 py-2">{article.unitOfMeasure}</td>
                        <td className="px-4 py-2">{Number(article.currentUnitCost).toFixed(4)}</td>
                        <td className="px-4 py-2">{article.unitsPerCarton ?? '—'}</td>
                        <td className="px-4 py-2">{article.densityKgPerL ?? '—'}</td>
                        <td className="px-4 py-2">
                          {article.supplierId ? (supplierById.get(article.supplierId)?.name ?? '—') : '—'}
                        </td>
                        <td className="px-4 py-2">
                          <span
                            className={
                              article.active
                                ? 'rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700'
                                : 'rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500'
                            }
                          >
                            {article.active ? 'Actif' : 'Désactivé'}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right whitespace-nowrap">
                          <button
                            onClick={() => startEdit(article)}
                            className="mr-3 text-xs text-blue-600 hover:underline"
                          >
                            Modifier
                          </button>
                          {article.active && (
                            <button
                              onClick={() => void handleDeactivate(article)}
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
