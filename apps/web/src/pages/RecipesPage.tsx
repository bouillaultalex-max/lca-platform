import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { Article, CreateRecipeLineRequest, Recipe } from '@lca-mes/shared';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/useAuth';
import { AppLayout } from '../components/AppLayout';

interface LineDraft {
  articleId: string;
  quantityPerUnit: string;
  unit: string;
}

function emptyLine(): LineDraft {
  return { articleId: '', quantityPerUnit: '', unit: '' };
}

const rowClass = (archived: boolean) =>
  `transition-colors odd:bg-white even:bg-gray-50/60 hover:bg-brand-bg ${archived ? 'opacity-60' : ''}`;

export function RecipesPage() {
  const { token } = useAuth();

  const [articles, setArticles] = useState<Article[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedProductId, setSelectedProductId] = useState('');
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [isLoadingRecipes, setIsLoadingRecipes] = useState(false);
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null);

  const [format, setFormat] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!token) return;
    api
      .listArticles(token)
      .then(setArticles)
      .catch((err: unknown) => setLoadError(err instanceof ApiError ? err.message : 'Impossible de charger les articles.'));
  }, [token]);

  const finishedProducts = useMemo(
    () => articles.filter((article) => article.type === 'PRODUIT_FINI' && article.active),
    [articles],
  );
  const ingredientArticles = useMemo(
    () => articles.filter((article) => article.type !== 'PRODUIT_FINI' && article.active),
    [articles],
  );
  const articleById = useMemo(() => new Map(articles.map((article) => [article.id, article])), [articles]);

  const loadRecipes = useCallback(
    async (productId: string) => {
      if (!token || !productId) {
        setRecipes([]);
        return;
      }
      setIsLoadingRecipes(true);
      try {
        setRecipes(await api.listRecipesByProduct(token, productId));
      } catch (err) {
        setLoadError(err instanceof ApiError ? err.message : 'Impossible de charger les recettes.');
      } finally {
        setIsLoadingRecipes(false);
      }
    },
    [token],
  );

  useEffect(() => {
    void loadRecipes(selectedProductId);
    setSelectedRecipeId(null);
  }, [loadRecipes, selectedProductId]);

  const selectedRecipe = recipes.find((recipe) => recipe.id === selectedRecipeId) ?? null;

  const percentageTotal = lines.reduce((total, line) => {
    const article = articleById.get(line.articleId);
    if (article?.type !== 'MATIERE_PREMIERE') return total;
    return total + (Number(line.quantityPerUnit) || 0);
  }, 0);

  function updateLine(index: number, patch: Partial<LineDraft>) {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function addLine() {
    setLines((current) => [...current, emptyLine()]);
  }

  function removeLine(index: number) {
    setLines((current) => current.filter((_, i) => i !== index));
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !selectedProductId) return;
    setFormError(null);
    setIsSubmitting(true);
    try {
      const payloadLines: CreateRecipeLineRequest[] = lines.map((line) => ({
        articleId: line.articleId,
        quantityPerUnit: Number(line.quantityPerUnit),
        unit: line.unit,
      }));
      await api.createRecipe(token, {
        finishedProductId: selectedProductId,
        format: Number(format),
        lines: payloadLines,
      });
      setFormat('');
      setLines([emptyLine()]);
      await loadRecipes(selectedProductId);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Impossible de créer la recette.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleArchive(recipe: Recipe) {
    if (!token) return;
    if (!confirm(`Archiver la version ${recipe.version} (format ${recipe.format} ml) sans la remplacer ?`)) {
      return;
    }
    try {
      await api.archiveRecipe(token, recipe.id);
      await loadRecipes(selectedProductId);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Impossible d’archiver la recette.');
    }
  }

  return (
    <AppLayout>
      <h2 className="text-xl font-semibold text-gray-900">Recettes</h2>
      <p className="mt-1 text-sm text-gray-500">
        Créer une recette crée toujours une nouvelle version : si une version active existe déjà pour ce produit
        et ce format, elle est archivée automatiquement.
      </p>

      {loadError && <p className="mt-4 text-sm text-red-600">{loadError}</p>}

      <div className="mt-6">
        <label className="mb-1.5 block text-xs font-medium text-gray-500">Produit fini</label>
        <select
          value={selectedProductId}
          onChange={(e) => setSelectedProductId(e.target.value)}
          className="w-full max-w-md rounded-md border border-brand-border px-3 py-2.5 text-sm transition-colors focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
        >
          <option value="">— Sélectionner un produit fini —</option>
          {finishedProducts.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name} ({product.openSiReference})
            </option>
          ))}
        </select>
        {finishedProducts.length === 0 && (
          <p className="mt-2 text-sm text-gray-500">
            Aucun produit fini actif. Créez-en un dans le <Link className="text-brand underline" to="/catalog">catalogue</Link>{' '}
            (type « Produit fini ») avant de créer une recette.
          </p>
        )}
      </div>

      {selectedProductId && (
        <>
          <div className="mt-6 overflow-x-auto rounded-xl border border-brand-border bg-white shadow-sm">
            <h3 className="border-b border-brand-border px-4 py-2 text-sm font-semibold text-gray-900">
              Historique des versions
            </h3>
            {isLoadingRecipes ? (
              <p className="p-4 text-sm text-gray-500">Chargement…</p>
            ) : (
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-gray-500">Format</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-500">Version</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-500">Statut</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {recipes.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-center text-gray-500">
                        Aucune recette pour ce produit.
                      </td>
                    </tr>
                  )}
                  {recipes.map((recipe) => (
                    <tr key={recipe.id} className={rowClass(recipe.status === 'ARCHIVEE')}>
                      <td className="px-4 py-2">{recipe.format} ml</td>
                      <td className="px-4 py-2">v{recipe.version}</td>
                      <td className="px-4 py-2">
                        <span
                          className={
                            recipe.status === 'ACTIVE'
                              ? 'rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700'
                              : 'rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500'
                          }
                        >
                          {recipe.status === 'ACTIVE' ? 'Active' : 'Archivée'}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <button
                          onClick={() => setSelectedRecipeId(recipe.id === selectedRecipeId ? null : recipe.id)}
                          className="mr-3 text-xs text-brand hover:underline"
                        >
                          {recipe.id === selectedRecipeId ? 'Masquer' : 'Voir la composition'}
                        </button>
                        {recipe.status === 'ACTIVE' && (
                          <button
                            onClick={() => void handleArchive(recipe)}
                            className="text-xs text-red-600 hover:underline"
                          >
                            Archiver
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {selectedRecipe && (
              <div className="border-t border-brand-border px-4 py-3">
                <h4 className="mb-2 text-sm font-semibold text-gray-900">
                  Composition — v{selectedRecipe.version} ({selectedRecipe.format} ml)
                </h4>
                <ul className="space-y-1 text-sm text-gray-700">
                  {selectedRecipe.lines.map((line) => (
                    <li key={line.id}>
                      {articleById.get(line.articleId)?.name ?? line.articleId} — {line.quantityPerUnit} {line.unit}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="mt-6 rounded-xl border border-brand-border bg-white p-6 shadow-sm">
            <h3 className="mb-4 text-sm font-semibold text-gray-900">Créer une nouvelle version</h3>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-500">Format (ml)</label>
                <input
                  required
                  type="number"
                  min="1"
                  value={format}
                  onChange={(e) => setFormat(e.target.value)}
                  className="w-40 rounded-md border border-brand-border px-3 py-2.5 text-sm transition-colors focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                />
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="block text-xs font-medium text-gray-500">Lignes de composition</label>
                  <span className="text-xs text-gray-500">
                    Total matières premières :{' '}
                    <span className={percentageTotal === 100 ? 'font-medium text-green-700' : 'font-medium text-amber-700'}>
                      {percentageTotal}%
                    </span>{' '}
                    (doit être 100%)
                  </span>
                </div>

                <div className="space-y-2">
                  {lines.map((line, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <select
                        required
                        value={line.articleId}
                        onChange={(e) => updateLine(index, { articleId: e.target.value })}
                        className="flex-1 rounded-md border border-brand-border px-3 py-2.5 text-sm transition-colors focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                      >
                        <option value="">— Article —</option>
                        {ingredientArticles.map((article) => (
                          <option key={article.id} value={article.id}>
                            {article.name} ({article.type === 'MATIERE_PREMIERE' ? 'MP' : 'Packaging'})
                          </option>
                        ))}
                      </select>
                      <input
                        required
                        type="number"
                        step="0.0001"
                        min="0"
                        placeholder="Quantité / %"
                        value={line.quantityPerUnit}
                        onChange={(e) => updateLine(index, { quantityPerUnit: e.target.value })}
                        className="w-36 rounded-md border border-brand-border px-3 py-2.5 text-sm transition-colors focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                      />
                      <input
                        required
                        placeholder="Unité (%, unité...)"
                        value={line.unit}
                        onChange={(e) => updateLine(index, { unit: e.target.value })}
                        className="w-36 rounded-md border border-brand-border px-3 py-2.5 text-sm transition-colors focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                      />
                      <button
                        type="button"
                        onClick={() => removeLine(index)}
                        disabled={lines.length === 1}
                        className="text-xs text-red-600 hover:underline disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Retirer
                      </button>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={addLine}
                  className="mt-2 text-xs font-medium text-brand hover:underline"
                >
                  + Ajouter une ligne
                </button>
              </div>

              {formError && <p className="text-sm text-red-600">{formError}</p>}

              <button
                type="submit"
                disabled={isSubmitting}
                className="rounded-md bg-brand px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? 'Création…' : 'Créer la version'}
              </button>
            </form>
          </div>
        </>
      )}
    </AppLayout>
  );
}
