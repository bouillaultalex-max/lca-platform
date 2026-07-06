import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ARTICLE_TYPE_LABELS, type Article, type ArticleType } from '@lca-mes/shared';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/useAuth';
import { AppLayout } from '../components/AppLayout';

const ARTICLE_TYPES: ArticleType[] = ['MATIERE_PREMIERE', 'PACKAGING', 'PRODUIT_FINI'];

const emptyForm = {
  type: 'MATIERE_PREMIERE' as ArticleType,
  openSiReference: '',
  name: '',
  unitOfMeasure: '',
  currentUnitCost: '',
};

export function CatalogPage() {
  const { token } = useAuth();
  const [articles, setArticles] = useState<Article[]>([]);
  const [filterType, setFilterType] = useState<ArticleType | ''>('');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
      });
      setForm(emptyForm);
      await loadArticles(filterType || undefined);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Impossible de créer l’article.');
    } finally {
      setIsSubmitting(false);
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
        <form onSubmit={handleCreate} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Type</label>
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as ArticleType })}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Désignation</label>
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Unité</label>
            <input
              required
              placeholder="L, kg, unité..."
              value={form.unitOfMeasure}
              onChange={(e) => setForm({ ...form, unitOfMeasure: e.target.value })}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="sm:col-span-2 lg:col-span-5">
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

      <div className="mt-6 flex items-center gap-2">
        <label className="text-sm font-medium text-gray-700">Filtrer par type :</label>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value as ArticleType | '')}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
                <th className="px-4 py-2 text-left font-medium text-gray-500">Statut</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {articles.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-gray-500">
                    Aucun article.
                  </td>
                </tr>
              )}
              {articles.map((article) => (
                <tr key={article.id} className={article.active ? '' : 'opacity-50'}>
                  <td className="px-4 py-2">{ARTICLE_TYPE_LABELS[article.type]}</td>
                  <td className="px-4 py-2 font-mono text-xs">{article.openSiReference}</td>
                  <td className="px-4 py-2">{article.name}</td>
                  <td className="px-4 py-2">{article.unitOfMeasure}</td>
                  <td className="px-4 py-2">{Number(article.currentUnitCost).toFixed(4)}</td>
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
                  <td className="px-4 py-2 text-right">
                    {article.active && (
                      <button
                        onClick={() => void handleDeactivate(article)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Désactiver
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
