import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { AromaSampleDetailResponse, AromaSampleListItem, AromaSampleSortBy, PaginationMeta } from '@lca-mes/shared';
import { api, ApiError } from '../../api/client';
import { useAuth } from '../../auth/useAuth';
import { AppLayout } from '../../components/AppLayout';
import { PageHeader } from '../../components/ui/PageHeader';
import { SectionCard } from '../../components/ui/SectionCard';
import { AromaSamplesTable } from './AromaSamplesTable';
import {
  DEFAULT_AROMA_SAMPLES_FILTERS,
  filtersToApiQuery,
  filtersToSearchParams,
  searchParamsToFilters,
  type AromaSamplesListFilters,
} from './aromaSamplesUrlState';

const inputClass =
  'w-full rounded-md border border-divider px-3 py-2.5 text-sm transition-colors focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy';

/** Évite une requête serveur à chaque frappe — mécanisme local simple, pas de hook générique. */
const SEARCH_DEBOUNCE_MS = 300;

const ACTIVE_FILTER_OPTIONS: { value: AromaSamplesListFilters['active']; label: string }[] = [
  { value: 'all', label: 'Tous' },
  { value: 'true', label: 'Actifs' },
  { value: 'false', label: 'Désactivés' },
];

export function AromaSamplesPage() {
  const { token } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  // Dépend de la chaîne sérialisée plutôt que de l'objet `searchParams` lui-même :
  // react-router ne garantit pas la stabilité référentielle de cet objet entre deux
  // rendus déclenchés par un état local sans rapport (ex. saisie dans la recherche).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const filters = useMemo(() => searchParamsToFilters(searchParams), [searchParams.toString()]);

  const [searchInput, setSearchInput] = useState(filters.search);
  const [categoryInput, setCategoryInput] = useState(filters.category);

  const [items, setItems] = useState<AromaSampleListItem[]>([]);
  const [meta, setMeta] = useState<PaginationMeta | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AromaSampleDetailResponse | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const latestRequestIdRef = useRef(0);
  const latestDetailRequestIdRef = useRef(0);

  // Fusionne contre les paramètres d'URL les plus récents (via la forme fonctionnelle
  // de `setSearchParams`, déjà utilisée ailleurs dans le projet — voir TraceabilityPage)
  // plutôt que contre `filters` capturé par fermeture : un debounce en attente (voir
  // ci-dessous) appelle cette fonction avec un `filters` potentiellement périmé si une
  // autre action (tri, page, filtre actif) a été effectuée entre-temps ; lire l'état
  // actuel au moment de l'écriture évite d'écraser silencieusement cette action.
  function updateFilters(partial: Partial<AromaSamplesListFilters>) {
    setSearchParams((prev) => {
      const current = searchParamsToFilters(prev);
      const next: AromaSamplesListFilters = { ...current, ...partial };
      if (!('page' in partial)) next.page = DEFAULT_AROMA_SAMPLES_FILTERS.page;
      return filtersToSearchParams(next);
    });
  }

  // Reflète tout changement d'URL externe (navigation retour/avant, lien partagé)
  // dans les champs de saisie locaux — sans rouvrir une boucle : après que le debounce
  // ci-dessous a lui-même écrit dans l'URL, ces valeurs sont déjà identiques.
  useEffect(() => setSearchInput(filters.search), [filters.search]);
  useEffect(() => setCategoryInput(filters.category), [filters.category]);

  useEffect(() => {
    const handle = setTimeout(() => {
      if (searchInput !== filters.search) updateFilters({ search: searchInput });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  useEffect(() => {
    const handle = setTimeout(() => {
      if (categoryInput !== filters.category) updateFilters({ category: categoryInput });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryInput]);

  const loadSamples = useCallback(async () => {
    if (!token) return;
    const requestId = ++latestRequestIdRef.current;
    setIsLoading(true);
    setLoadError(null);
    try {
      const result = await api.listAromaSamples(token, filtersToApiQuery(filters));
      if (requestId !== latestRequestIdRef.current) return;
      setItems(result.items);
      setMeta(result.meta);
    } catch (err) {
      if (requestId !== latestRequestIdRef.current) return;
      setLoadError(err instanceof ApiError ? err.message : 'Impossible de charger les échantillons.');
    } finally {
      if (requestId === latestRequestIdRef.current) setIsLoading(false);
    }
  }, [token, filters]);

  useEffect(() => {
    void loadSamples();
  }, [loadSamples]);

  const categorySuggestions = useMemo(
    () => Array.from(new Set(items.map((item) => item.category))).sort((a, b) => a.localeCompare(b, 'fr')),
    [items],
  );

  async function toggleExpand(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    setDetail(null);
    setDetailError(null);
    if (!token) return;
    // Même garde anti-réponses-désordonnées que `loadSamples` ci-dessus : une ouverture
    // rapide de deux lignes différentes ne doit jamais laisser la réponse la plus lente
    // écraser le détail de la ligne réellement dépliée.
    const requestId = ++latestDetailRequestIdRef.current;
    setIsLoadingDetail(true);
    try {
      const result = await api.getAromaSample(token, id);
      if (requestId !== latestDetailRequestIdRef.current) return;
      setDetail(result);
    } catch (err) {
      if (requestId !== latestDetailRequestIdRef.current) return;
      setDetailError(err instanceof ApiError ? err.message : 'Impossible de charger le détail.');
    } finally {
      if (requestId === latestDetailRequestIdRef.current) setIsLoadingDetail(false);
    }
  }

  function handleSortChange(column: AromaSampleSortBy) {
    if (filters.sortBy === column) {
      updateFilters({ sortOrder: filters.sortOrder === 'asc' ? 'desc' : 'asc' });
    } else {
      updateFilters({ sortBy: column, sortOrder: 'asc' });
    }
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <PageHeader
          title="Aromathèque"
          description="Consultation des échantillons fournisseurs (R&D, tranche 1)."
          action={
            <Link
              to="/imports"
              className="rounded-md bg-navy px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-navy-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
            >
              Importer des échantillons →
            </Link>
          }
        />

        <SectionCard title="Échantillons">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[220px] flex-1">
                <label htmlFor="aroma-search" className="mb-1.5 block text-xs font-medium text-gray-500">
                  Rechercher
                </label>
                <input
                  id="aroma-search"
                  placeholder="Produit, fournisseur, référence, identifiant..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div className="min-w-[180px]">
                <label htmlFor="aroma-category" className="mb-1.5 block text-xs font-medium text-gray-500">
                  Catégorie
                </label>
                <input
                  id="aroma-category"
                  list="aroma-category-suggestions"
                  placeholder="Toutes"
                  value={categoryInput}
                  onChange={(e) => setCategoryInput(e.target.value)}
                  className={inputClass}
                />
                <datalist id="aroma-category-suggestions">
                  {categorySuggestions.map((category) => (
                    <option key={category} value={category} />
                  ))}
                </datalist>
              </div>
              {categoryInput && (
                <button
                  type="button"
                  onClick={() => setCategoryInput('')}
                  className="mb-0.5 text-xs text-gray-500 hover:text-navy hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
                >
                  Effacer la catégorie
                </button>
              )}
            </div>

            <div role="group" aria-label="Filtrer par statut" className="flex flex-wrap gap-2">
              {ACTIVE_FILTER_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={filters.active === option.value}
                  onClick={() => updateFilters({ active: option.value })}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy ${
                    filters.active === option.value
                      ? 'border-navy bg-navy text-white'
                      : 'border-divider bg-white text-gray-600 hover:border-navy hover:text-navy'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {meta && (
              <p className="text-sm text-gray-500">
                <span className="font-semibold text-gray-900">{meta.total}</span> échantillon(s)
                {meta.totalPages > 0 && (
                  <>
                    <span className="mx-1.5 text-gray-300">·</span>
                    page <span className="font-semibold text-gray-900">{meta.page}</span> / {meta.totalPages}
                  </>
                )}
              </p>
            )}
          </div>

          <div className="mt-4">
            {loadError && <p className="mb-3 text-sm text-red-600">{loadError}</p>}
            {isLoading ? (
              <p className="p-4 text-sm text-gray-500">Chargement…</p>
            ) : (
              <AromaSamplesTable
                items={items}
                sortBy={filters.sortBy}
                sortOrder={filters.sortOrder}
                onSortChange={handleSortChange}
                expandedId={expandedId}
                onToggleExpand={(id) => void toggleExpand(id)}
                detail={detail}
                isLoadingDetail={isLoadingDetail}
                detailError={detailError}
              />
            )}
          </div>

          {meta && meta.totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between">
              <button
                type="button"
                onClick={() => updateFilters({ page: filters.page - 1 })}
                disabled={filters.page <= 1}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 transition hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:cursor-not-allowed disabled:opacity-60"
              >
                ← Précédent
              </button>
              <span className="text-sm text-gray-500">
                Page {meta.page} / {meta.totalPages}
              </span>
              <button
                type="button"
                onClick={() => updateFilters({ page: filters.page + 1 })}
                disabled={filters.page >= meta.totalPages}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 transition hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:cursor-not-allowed disabled:opacity-60"
              >
                Suivant →
              </button>
            </div>
          )}
        </SectionCard>
      </div>
    </AppLayout>
  );
}
