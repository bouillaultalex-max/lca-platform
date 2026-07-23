import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { Article, CreateRecipeLineRequest, Recipe, RecipeDraft, Supplier } from '@lca-mes/shared';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/useAuth';
import { AppLayout } from '../components/AppLayout';
import { ArticleSearchSelect } from '../components/ArticleSearchSelect';
import { PageHeader } from '../components/ui/PageHeader';
import { SectionCard } from '../components/ui/SectionCard';
import { useRecipeDraftAutosave, type RecipeDraftAutosaveContent } from '../hooks/useRecipeDraftAutosave';

interface LineDraft {
  articleId: string;
  quantityPerUnit: string;
  unit: string;
}

function emptyLine(): LineDraft {
  return { articleId: '', quantityPerUnit: '', unit: '' };
}

function draftLinesToLineDrafts(draftLines: RecipeDraft['content']['lines']): LineDraft[] {
  if (draftLines.length === 0) return [emptyLine()];
  return draftLines.map((line) => ({
    articleId: line.articleId ?? '',
    quantityPerUnit: line.quantityPerUnit ?? '',
    unit: line.unit ?? '',
  }));
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

const rowClass = (archived: boolean) =>
  `transition-colors odd:bg-white even:bg-gray-50/60 hover:bg-surface-muted ${archived ? 'opacity-60' : ''}`;

export function RecipesPage() {
  const { token } = useAuth();

  const [articles, setArticles] = useState<Article[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedProductId, setSelectedProductId] = useState('');
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [isLoadingRecipes, setIsLoadingRecipes] = useState(false);
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null);

  const [format, setFormat] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Brouillon de recette (voir docs/adr/0004-brouillons-recettes.md) : un brouillon
  // existant est proposé (reprendre/supprimer/dupliquer) avant d'afficher le formulaire.
  const [existingDraft, setExistingDraft] = useState<RecipeDraft | null>(null);
  const [isCheckingDraft, setIsCheckingDraft] = useState(false);
  const [draftChoiceMade, setDraftChoiceMade] = useState(false);
  const [draftActionError, setDraftActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    api
      .listArticles(token)
      .then(setArticles)
      .catch((err: unknown) => setLoadError(err instanceof ApiError ? err.message : 'Impossible de charger les articles.'));
  }, [token]);

  useEffect(() => {
    if (!token) return;
    api
      .listSuppliers(token)
      .then(setSuppliers)
      .catch(() => {
        /* Non bloquant : le sélecteur d'ingrédient affichera simplement le fournisseur en moins. */
      });
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
  const supplierById = useMemo(() => new Map(suppliers.map((supplier) => [supplier.id, supplier])), [suppliers]);

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

  // À chaque changement de produit : formulaire vierge, et vérification d'un brouillon
  // existant pour ce produit avant de décider quoi afficher (bandeau ou formulaire).
  useEffect(() => {
    setFormat('');
    setLines([emptyLine()]);
    setFormError(null);
    setDraftActionError(null);
    setExistingDraft(null);

    if (!token || !selectedProductId) {
      setDraftChoiceMade(false);
      return;
    }

    let cancelled = false;
    setIsCheckingDraft(true);
    setDraftChoiceMade(false);
    api
      .getRecipeDraft(token, selectedProductId)
      .then((draft) => {
        if (cancelled) return;
        if (draft) {
          setExistingDraft(draft);
        } else {
          setDraftChoiceMade(true);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(
          err instanceof ApiError ? err.message : 'Impossible de vérifier l’existence d’un brouillon.',
        );
        setDraftChoiceMade(true);
      })
      .finally(() => {
        if (!cancelled) setIsCheckingDraft(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token, selectedProductId]);

  const autosaveContent = useMemo<RecipeDraftAutosaveContent>(
    () => ({
      format: format === '' ? null : Number(format),
      lines: lines.map((line) => ({
        articleId: line.articleId,
        quantityPerUnit: line.quantityPerUnit,
        unit: line.unit,
      })),
    }),
    [format, lines],
  );

  const draftAutosave = useRecipeDraftAutosave(
    token,
    selectedProductId,
    autosaveContent,
    Boolean(token) && Boolean(selectedProductId) && draftChoiceMade,
  );

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

  function handleResumeDraft() {
    if (!existingDraft) return;
    setFormat(existingDraft.content.format != null ? String(existingDraft.content.format) : '');
    setLines(draftLinesToLineDrafts(existingDraft.content.lines));
    setDraftChoiceMade(true);
  }

  async function handleDeleteDraft() {
    if (!existingDraft || !token) return;
    setDraftActionError(null);
    try {
      await api.deleteRecipeDraft(token, existingDraft.id);
      setExistingDraft(null);
      setDraftChoiceMade(true);
    } catch (err) {
      setDraftActionError(err instanceof ApiError ? err.message : 'Impossible de supprimer le brouillon.');
    }
  }

  function handleDuplicateDraft() {
    if (!existingDraft) return;
    // Le brouillon enregistré reste intact tant que l'utilisateur ne modifie pas
    // réellement cette copie locale : aucun enregistrement immédiat ici. La copie ne
    // remplacera l'original que via l'autosave normal (dès la première vraie
    // modification), avec l'indicateur "Brouillon enregistré à HH:mm" pour le signaler
    // clairement — jamais un écrasement silencieux au moment du clic.
    setFormat('');
    setLines(draftLinesToLineDrafts(existingDraft.content.lines));
    setDraftChoiceMade(true);
    setExistingDraft(null);
  }

  async function handleReloadAfterConflict() {
    const server = await draftAutosave.resolveConflictReload();
    if (server) {
      setFormat(server.content.format != null ? String(server.content.format) : '');
      setLines(draftLinesToLineDrafts(server.content.lines));
    } else {
      setFormat('');
      setLines([emptyLine()]);
    }
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !selectedProductId) return;
    setFormError(null);
    if (lines.some((line) => !line.articleId)) {
      setFormError('Veuillez sélectionner un article pour chaque ligne.');
      return;
    }
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
      // La création réussie efface le brouillon côté serveur (voir RecipesService.create) :
      // on arrête l'autosave avant de vider le formulaire, sinon un brouillon vide serait
      // recréé quelques secondes plus tard.
      draftAutosave.stop();
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

  const showDraftBanner = Boolean(existingDraft) && !draftChoiceMade;
  const showForm = draftChoiceMade;

  return (
    <AppLayout>
      <div className="space-y-6">
        <PageHeader
          title="Recettes"
          description="Créer une recette crée toujours une nouvelle version : si une version active existe déjà pour ce produit et ce format, elle est archivée automatiquement."
        />

        {loadError && (
          <p role="alert" className="text-sm text-red-600">
            {loadError}
          </p>
        )}

        <SectionCard title="Sélection du produit">
          <label htmlFor="recipe-product" className="mb-1.5 block text-xs font-medium text-gray-500">
            Produit fini
          </label>
          <select
            id="recipe-product"
            value={selectedProductId}
            onChange={(e) => setSelectedProductId(e.target.value)}
            className="w-full max-w-md rounded-md border border-divider px-3 py-2.5 text-sm transition-colors focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
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
              Aucun produit fini actif. Créez-en un dans le{' '}
              <Link
                className="text-navy underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
                to="/catalog"
              >
                catalogue
              </Link>{' '}
              (type « Produit fini ») avant de créer une recette.
            </p>
          )}
        </SectionCard>

        {selectedProductId && (
          <>
            <SectionCard title="Historique des versions">
              {isLoadingRecipes ? (
                <p className="text-sm text-gray-500">Chargement…</p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-divider">
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
                              className="mr-3 text-xs text-navy hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
                            >
                              {recipe.id === selectedRecipeId ? 'Masquer' : 'Voir la composition'}
                            </button>
                            {recipe.status === 'ACTIVE' && (
                              <button
                                onClick={() => void handleArchive(recipe)}
                                className="text-xs text-red-600 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
                              >
                                Archiver
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {selectedRecipe && (
                <div className="mt-4 border-t border-divider pt-3">
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
            </SectionCard>

            {isCheckingDraft && (
              <div className="rounded-xl border border-divider bg-white p-6 text-sm text-gray-500 shadow-sm">
                Vérification d’un brouillon existant…
              </div>
            )}

            {showDraftBanner && existingDraft && (
              <div className="rounded-xl border border-mf-red bg-white p-6 shadow-sm">
                <h3 className="text-sm font-semibold text-gray-900">Un brouillon existe pour ce produit</h3>
                <p className="mt-1 text-sm text-gray-600">
                  Brouillon enregistré à {formatTime(new Date(existingDraft.updatedAt))}.
                </p>
                {draftActionError && (
                  <p role="alert" className="mt-2 text-sm text-red-600">
                    {draftActionError}
                  </p>
                )}
                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={handleResumeDraft}
                    className="rounded-md bg-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
                  >
                    Reprendre le brouillon
                  </button>
                  <button
                    type="button"
                    onClick={handleDuplicateDraft}
                    className="rounded-md border border-divider bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
                  >
                    Dupliquer le brouillon
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteDraft()}
                    className="rounded-md border border-red-200 px-4 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
                  >
                    Supprimer le brouillon
                  </button>
                </div>
              </div>
            )}

            {showForm && (
              <SectionCard title="Créer une nouvelle version">
                {draftAutosave.conflict && (
                  <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-4">
                    <p className="text-sm font-medium text-amber-800">
                      Ce brouillon a été modifié depuis un autre poste ou un autre onglet.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={() => void handleReloadAfterConflict()}
                        className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
                      >
                        Recharger la dernière version
                      </button>
                      <button
                        type="button"
                        onClick={() => void draftAutosave.resolveConflictForce()}
                        className="rounded-md border border-amber-400 px-3 py-1.5 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
                      >
                        Forcer l’enregistrement de ma version
                      </button>
                    </div>
                  </div>
                )}

                <form onSubmit={handleCreate} className="space-y-4">
                  <div>
                    <label htmlFor="recipe-format" className="mb-1.5 block text-xs font-medium text-gray-500">
                      Format (ml)
                    </label>
                    <input
                      id="recipe-format"
                      required
                      type="number"
                      min="1"
                      value={format}
                      onChange={(e) => setFormat(e.target.value)}
                      className="w-40 rounded-md border border-divider px-3 py-2.5 text-sm transition-colors focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
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
                        <div key={index} className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
                          <div className="w-full sm:w-auto sm:flex-1">
                            <label htmlFor={`recipe-line-${index}-article`} className="sr-only">
                              Article
                            </label>
                            <ArticleSearchSelect
                              id={`recipe-line-${index}-article`}
                              articles={ingredientArticles}
                              supplierById={supplierById}
                              value={line.articleId}
                              onChange={(articleId) => updateLine(index, { articleId })}
                            />
                          </div>
                          <label htmlFor={`recipe-line-${index}-quantity`} className="sr-only">
                            Quantité / %
                          </label>
                          <input
                            id={`recipe-line-${index}-quantity`}
                            required
                            type="number"
                            step="0.0001"
                            min="0"
                            placeholder="Quantité / %"
                            value={line.quantityPerUnit}
                            onChange={(e) => updateLine(index, { quantityPerUnit: e.target.value })}
                            className="w-full rounded-md border border-divider px-3 py-2.5 text-sm transition-colors focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy sm:w-36"
                          />
                          <label htmlFor={`recipe-line-${index}-unit`} className="sr-only">
                            Unité
                          </label>
                          <input
                            id={`recipe-line-${index}-unit`}
                            required
                            placeholder="Unité (%, unité...)"
                            value={line.unit}
                            onChange={(e) => updateLine(index, { unit: e.target.value })}
                            className="w-full rounded-md border border-divider px-3 py-2.5 text-sm transition-colors focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy sm:w-36"
                          />
                          <button
                            type="button"
                            onClick={() => removeLine(index)}
                            disabled={lines.length === 1}
                            className="text-xs text-red-600 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Retirer
                          </button>
                        </div>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={addLine}
                      className="mt-2 text-xs font-medium text-navy hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
                    >
                      + Ajouter une ligne
                    </button>
                  </div>

                  {formError && (
                    <p role="alert" className="text-sm text-red-600">
                      {formError}
                    </p>
                  )}

                  <div className="flex items-center gap-4">
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="rounded-md bg-navy px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-navy-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isSubmitting ? 'Création…' : 'Créer la version'}
                    </button>
                    <p role={draftAutosave.saveError ? 'alert' : undefined} className="text-xs text-gray-500">
                      {draftAutosave.isSaving
                        ? 'Enregistrement du brouillon…'
                        : draftAutosave.saveError
                          ? `Échec de l’enregistrement automatique — dernière sauvegarde ${
                              draftAutosave.lastSavedAt ? `à ${formatTime(draftAutosave.lastSavedAt)}` : 'jamais effectuée'
                            }.`
                          : draftAutosave.lastSavedAt
                            ? `Brouillon enregistré à ${formatTime(draftAutosave.lastSavedAt)}`
                            : ''}
                    </p>
                  </div>
                </form>
              </SectionCard>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}
