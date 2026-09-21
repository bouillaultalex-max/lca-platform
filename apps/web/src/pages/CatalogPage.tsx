import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ARTICLE_TYPE_LABELS,
  type Article,
  type ArticleType,
  type Market,
  type ProductFamily,
  type Supplier,
} from '@lca-mes/shared';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/useAuth';
import { AppLayout } from '../components/AppLayout';
import { PageHeader } from '../components/ui/PageHeader';
import { SectionCard } from '../components/ui/SectionCard';
import { matchesArticleSearch } from '../utils/matchesArticleSearch';
import { resetMarketFamilyOnTypeChange } from '../utils/resetMarketFamilyOnTypeChange';
import { resetUnitOfMeasureOnTypeChange } from '../utils/resetUnitOfMeasureOnTypeChange';

const ARTICLE_TYPES: ArticleType[] = ['MATIERE_PREMIERE', 'PACKAGING', 'PRODUIT_FINI'];

const FILTER_OPTIONS: Array<{ value: ArticleType | ''; label: string }> = [
  { value: '', label: 'Tous' },
  { value: 'MATIERE_PREMIERE', label: ARTICLE_TYPE_LABELS.MATIERE_PREMIERE },
  { value: 'PACKAGING', label: ARTICLE_TYPE_LABELS.PACKAGING },
  { value: 'PRODUIT_FINI', label: ARTICLE_TYPE_LABELS.PRODUIT_FINI },
];

/**
 * Fournisseur principal autorisé pour les matières premières et le packaging,
 * jamais pour un produit fini (retour Kevin : le laboratoire gère aussi les
 * commandes de packaging) — voir la même règle côté ArticlesService.
 */
function canHaveSupplier(type: ArticleType): boolean {
  return type === 'MATIERE_PREMIERE' || type === 'PACKAGING';
}

/**
 * Famille commerciale et marché pertinents uniquement pour un produit fini —
 * voir ADR 0006 (PRD-11) et la même règle côté ArticlesService.
 */
function canHaveMarketFamily(type: ArticleType): boolean {
  return type === 'PRODUIT_FINI';
}

/**
 * L'unité de mesure n'est significative que pour une matière première (voir
 * audit préalable : jamais utilisée dans un calcul pour PACKAGING/PRODUIT_FINI,
 * uniquement en affichage) — voir la même règle côté ArticlesService.
 */
function canHaveUnitOfMeasure(type: ArticleType): boolean {
  return type === 'MATIERE_PREMIERE';
}

const inputClass =
  'w-full rounded-md border border-divider px-3 py-2.5 text-sm transition-colors focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy';

const rowClass = (active: boolean) =>
  `transition-colors odd:bg-white even:bg-gray-50/60 hover:bg-surface-muted ${active ? '' : 'opacity-50'}`;

const emptyForm = {
  type: 'MATIERE_PREMIERE' as ArticleType,
  openSiReference: '',
  name: '',
  unitOfMeasure: '',
  currentUnitCost: '',
  unitsPerCarton: '',
  densityKgPerL: '',
  supplierId: '',
  productFamilyId: '',
  marketId: '',
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
  productFamilyId: string;
  marketId: string;
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
    productFamilyId: article.productFamilyId ?? '',
    marketId: article.marketId ?? '',
  };
}

export function CatalogPage() {
  const { token } = useAuth();
  const [articles, setArticles] = useState<Article[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [productFamilies, setProductFamilies] = useState<ProductFamily[]>([]);
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

  useEffect(() => {
    if (!token) return;
    api
      .listMarkets(token)
      .then(setMarkets)
      .catch(() => {
        /* Non bloquant : le tableau affichera simplement "—" si la liste échoue à charger. */
      });
    api
      .listProductFamilies(token)
      .then(setProductFamilies)
      .catch(() => {
        /* Non bloquant : le tableau affichera simplement "—" si la liste échoue à charger. */
      });
  }, [token]);

  const supplierById = useMemo(() => new Map(suppliers.map((supplier) => [supplier.id, supplier])), [suppliers]);
  const activeSuppliers = useMemo(() => suppliers.filter((supplier) => supplier.active), [suppliers]);

  const marketById = useMemo(() => new Map(markets.map((market) => [market.id, market])), [markets]);
  const activeMarkets = useMemo(() => markets.filter((market) => market.active), [markets]);

  const productFamilyById = useMemo(
    () => new Map(productFamilies.map((productFamily) => [productFamily.id, productFamily])),
    [productFamilies],
  );
  const activeProductFamilies = useMemo(
    () => productFamilies.filter((productFamily) => productFamily.active),
    [productFamilies],
  );

  const filteredArticles = useMemo(
    () =>
      articles.filter((article) =>
        matchesArticleSearch(article, article.supplierId ? (supplierById.get(article.supplierId)?.name ?? null) : null, search),
      ),
    [articles, search, supplierById],
  );

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
        unitOfMeasure: canHaveUnitOfMeasure(form.type) ? form.unitOfMeasure : undefined,
        currentUnitCost: Number(form.currentUnitCost),
        unitsPerCarton: form.unitsPerCarton ? Number(form.unitsPerCarton) : undefined,
        densityKgPerL: form.densityKgPerL ? Number(form.densityKgPerL) : undefined,
        supplierId: canHaveSupplier(form.type) && form.supplierId ? form.supplierId : undefined,
        productFamilyId: canHaveMarketFamily(form.type) && form.productFamilyId ? form.productFamilyId : undefined,
        marketId:
          canHaveMarketFamily(form.type) && form.productFamilyId && form.marketId ? form.marketId : undefined,
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
        unitOfMeasure: canHaveUnitOfMeasure(editForm.type) ? editForm.unitOfMeasure : undefined,
        currentUnitCost: Number(editForm.currentUnitCost),
        unitsPerCarton: editForm.unitsPerCarton ? Number(editForm.unitsPerCarton) : undefined,
        densityKgPerL: editForm.densityKgPerL ? Number(editForm.densityKgPerL) : undefined,
        supplierId: canHaveSupplier(editForm.type) && editForm.supplierId ? editForm.supplierId : undefined,
        productFamilyId:
          canHaveMarketFamily(editForm.type) && editForm.productFamilyId ? editForm.productFamilyId : undefined,
        marketId:
          canHaveMarketFamily(editForm.type) && editForm.productFamilyId && editForm.marketId
            ? editForm.marketId
            : undefined,
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
      <div className="space-y-6">
        <PageHeader
          title="Catalogue"
          description="Matières premières, packaging et produits finis. La désactivation préserve l’historique (recettes, stock, lots) sans suppression physique."
        />

        <SectionCard title="Nouveau produit">
          <form onSubmit={handleCreate} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500">Type</label>
              <select
                value={form.type}
                onChange={(e) => {
                  const nextType = e.target.value as ArticleType;
                  setForm(
                    resetUnitOfMeasureOnTypeChange(
                      resetMarketFamilyOnTypeChange({ ...form, type: nextType }, nextType),
                      nextType,
                    ),
                  );
                }}
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
              <label className="mb-1.5 block text-xs font-medium text-gray-500">Référence OpenSi</label>
              <input
                required
                value={form.openSiReference}
                onChange={(e) => setForm({ ...form, openSiReference: e.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500">Désignation</label>
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className={inputClass}
              />
            </div>
            {canHaveUnitOfMeasure(form.type) && (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500">Unité</label>
              <input
                required
                placeholder="L, kg, unité..."
                value={form.unitOfMeasure}
                onChange={(e) => setForm({ ...form, unitOfMeasure: e.target.value })}
                className={inputClass}
              />
            </div>
            )}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500">Coût unitaire</label>
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
              <label className="mb-1.5 block text-xs font-medium text-gray-500">
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
              <label className="mb-1.5 block text-xs font-medium text-gray-500">
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
                <label className="mb-1.5 block text-xs font-medium text-gray-500">
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
            {canHaveMarketFamily(form.type) && (
              <>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-gray-500">
                    Famille commerciale <span className="font-normal text-gray-400">(optionnel)</span>
                  </label>
                  <select
                    value={form.productFamilyId}
                    onChange={(e) => setForm({ ...form, productFamilyId: e.target.value, marketId: '' })}
                    className={inputClass}
                  >
                    <option value="">Aucune</option>
                    {activeProductFamilies.map((productFamily) => (
                      <option key={productFamily.id} value={productFamily.id}>
                        {productFamily.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-gray-500">
                    Marché{' '}
                    <span className="font-normal text-gray-400">
                      (optionnel, nécessite une famille commerciale)
                    </span>
                  </label>
                  <select
                    value={form.marketId}
                    onChange={(e) => setForm({ ...form, marketId: e.target.value })}
                    disabled={!form.productFamilyId}
                    className={`${inputClass} disabled:cursor-not-allowed disabled:opacity-60`}
                  >
                    <option value="">Aucun</option>
                    {activeMarkets.map((market) => (
                      <option key={market.id} value={market.id}>
                        {market.label}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}

            <div className="sm:col-span-2 lg:col-span-4">
              {formError && <p className="mb-2 text-sm text-red-600">{formError}</p>}
              <button
                type="submit"
                disabled={isSubmitting}
                className="rounded-md bg-navy px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-navy-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? 'Création…' : 'Créer l’article'}
              </button>
            </div>
          </form>
        </SectionCard>

        <SectionCard title="Catalogue">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="catalog-search" className="sr-only">
                Rechercher un article
              </label>
              <input
                id="catalog-search"
                placeholder="Rechercher (désignation, référence, fournisseur, type)..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className={`${inputClass} max-w-xs`}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="text-xs text-gray-500 hover:text-navy hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
                >
                  Effacer la recherche
                </button>
              )}
            </div>

            <div role="group" aria-label="Filtrer par type" className="flex flex-wrap gap-2">
              {FILTER_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={filterType === option.value}
                  onClick={() => setFilterType(option.value)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy ${
                    filterType === option.value
                      ? 'border-navy bg-navy text-white'
                      : 'border-divider bg-white text-gray-600 hover:border-navy hover:text-navy'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <p className="text-sm text-gray-500">
              <span className="font-semibold text-gray-900">{articles.length}</span> articles
              <span className="mx-1.5 text-gray-300">·</span>
              <span className="font-semibold text-gray-900">{filteredArticles.length}</span> affichés
            </p>
          </div>

          <div className="mt-4 overflow-x-auto rounded-xl border border-divider">
            {loadError && <p className="p-4 text-sm text-red-600">{loadError}</p>}
            {isLoading ? (
              <p className="p-4 text-sm text-gray-500">Chargement…</p>
            ) : (
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-gray-500">Désignation</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-500">Type</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-500">Référence</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-500">Unité</th>
                    <th className="px-4 py-2 text-right font-medium text-gray-500">Coût unitaire</th>
                    <th className="px-4 py-2 text-right font-medium text-gray-500">Unités/carton</th>
                    <th className="px-4 py-2 text-right font-medium text-gray-500">Densité kg/L</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-500">Fournisseur</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-500">Famille / Marché</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-500">Statut</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredArticles.length === 0 && (
                    <tr>
                      <td colSpan={11} className="px-4 py-6 text-center text-gray-500">
                        {articles.length === 0 ? 'Aucun article.' : 'Aucun article ne correspond à votre recherche.'}
                      </td>
                    </tr>
                  )}
                  {filteredArticles.map((article) => {
                    const isEditing = editingId === article.id;
                    return (
                      <tr key={article.id} className={rowClass(article.active)}>
                        {isEditing && editForm ? (
                          <>
                            <td className="px-4 py-2">
                              <input
                                value={editForm.name}
                                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                                className="w-full rounded-md border border-divider px-2 py-1 text-sm transition-colors focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
                              />
                            </td>
                            <td className="px-4 py-2">
                              <select
                                value={editForm.type}
                                onChange={(e) => {
                                  const nextType = e.target.value as ArticleType;
                                  setEditForm(
                                    resetUnitOfMeasureOnTypeChange(
                                      resetMarketFamilyOnTypeChange(
                                        { ...editForm, type: nextType },
                                        nextType,
                                      ),
                                      nextType,
                                    ),
                                  );
                                }}
                                className="w-full rounded-md border border-divider px-2 py-1 text-sm transition-colors focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
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
                                className="w-full rounded-md border border-divider px-2 py-1 text-sm transition-colors focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
                              />
                            </td>
                            <td className="px-4 py-2">
                              {canHaveUnitOfMeasure(editForm.type) ? (
                                <input
                                  value={editForm.unitOfMeasure}
                                  onChange={(e) => setEditForm({ ...editForm, unitOfMeasure: e.target.value })}
                                  className="w-20 rounded-md border border-divider px-2 py-1 text-sm transition-colors focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
                                />
                              ) : (
                                <span className="text-gray-400">—</span>
                              )}
                            </td>
                            <td className="px-4 py-2">
                              <input
                                type="number"
                                min="0"
                                step="0.0001"
                                value={editForm.currentUnitCost}
                                onChange={(e) => setEditForm({ ...editForm, currentUnitCost: e.target.value })}
                                className="w-24 rounded-md border border-divider px-2 py-1 text-right text-sm transition-colors focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
                              />
                            </td>
                            <td className="px-4 py-2">
                              <input
                                type="number"
                                min="1"
                                step="1"
                                value={editForm.unitsPerCarton}
                                onChange={(e) => setEditForm({ ...editForm, unitsPerCarton: e.target.value })}
                                className="w-20 rounded-md border border-divider px-2 py-1 text-right text-sm transition-colors focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
                              />
                            </td>
                            <td className="px-4 py-2">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={editForm.densityKgPerL}
                                onChange={(e) => setEditForm({ ...editForm, densityKgPerL: e.target.value })}
                                className="w-20 rounded-md border border-divider px-2 py-1 text-right text-sm transition-colors focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
                              />
                            </td>
                            <td className="px-4 py-2">
                              {canHaveSupplier(editForm.type) ? (
                                <select
                                  value={editForm.supplierId}
                                  onChange={(e) => setEditForm({ ...editForm, supplierId: e.target.value })}
                                  className="w-full rounded-md border border-divider px-2 py-1 text-sm transition-colors focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
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
                            <td className="px-4 py-2">
                              {canHaveMarketFamily(editForm.type) ? (
                                <div className="flex flex-col gap-1">
                                  <select
                                    value={editForm.productFamilyId}
                                    onChange={(e) =>
                                      setEditForm({ ...editForm, productFamilyId: e.target.value, marketId: '' })
                                    }
                                    className="w-full rounded-md border border-divider px-2 py-1 text-sm transition-colors focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
                                  >
                                    <option value="">Aucune famille</option>
                                    {activeProductFamilies.map((productFamily) => (
                                      <option key={productFamily.id} value={productFamily.id}>
                                        {productFamily.name}
                                      </option>
                                    ))}
                                  </select>
                                  <select
                                    value={editForm.marketId}
                                    onChange={(e) => setEditForm({ ...editForm, marketId: e.target.value })}
                                    disabled={!editForm.productFamilyId}
                                    className="w-full rounded-md border border-divider px-2 py-1 text-sm transition-colors focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    <option value="">Aucun marché</option>
                                    {activeMarkets.map((market) => (
                                      <option key={market.id} value={market.id}>
                                        {market.label}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              ) : (
                                <span className="text-gray-400">—</span>
                              )}
                            </td>
                            <td className="px-4 py-2 text-gray-500">{article.active ? 'Actif' : 'Désactivé'}</td>
                            <td className="px-4 py-2 text-right whitespace-nowrap">
                              {editError && <p className="mb-1 text-xs text-red-600">{editError}</p>}
                              <button
                                onClick={() => void handleSaveEdit(article.id)}
                                className="mr-2 text-xs font-medium text-navy hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
                              >
                                Enregistrer
                              </button>
                              <button
                                onClick={() => {
                                  setEditingId(null);
                                  setEditForm(null);
                                }}
                                className="text-xs text-gray-500 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
                              >
                                Annuler
                              </button>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="px-4 py-2 font-medium text-gray-900">{article.name}</td>
                            <td className="px-4 py-2">{ARTICLE_TYPE_LABELS[article.type]}</td>
                            <td className="px-4 py-2 font-mono text-xs">{article.openSiReference}</td>
                            <td className="px-4 py-2">
                              {canHaveUnitOfMeasure(article.type) ? article.unitOfMeasure : '—'}
                            </td>
                            <td className="px-4 py-2 text-right">{Number(article.currentUnitCost).toFixed(4)}</td>
                            <td className="px-4 py-2 text-right">{article.unitsPerCarton ?? '—'}</td>
                            <td className="px-4 py-2 text-right">{article.densityKgPerL ?? '—'}</td>
                            <td className="px-4 py-2">
                              {article.supplierId ? (supplierById.get(article.supplierId)?.name ?? '—') : '—'}
                            </td>
                            <td className="px-4 py-2">
                              {article.productFamilyId ? (
                                <>
                                  {productFamilyById.get(article.productFamilyId)?.name ?? '—'}
                                  {article.marketId && ` (${marketById.get(article.marketId)?.label ?? '—'})`}
                                </>
                              ) : (
                                '—'
                              )}
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
                                className="mr-3 text-xs text-navy hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
                              >
                                Modifier
                              </button>
                              {article.active && (
                                <button
                                  onClick={() => void handleDeactivate(article)}
                                  className="text-xs text-red-600 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
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
        </SectionCard>
      </div>
    </AppLayout>
  );
}
