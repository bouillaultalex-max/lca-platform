import type { AromaSampleSortBy, AromaSampleSortOrder, AromaSamplesQuery } from '@lca-mes/shared';

/**
 * État de filtre de la liste Aromathèque, synchronisé avec l'URL (voir
 * AromaSamplesPage). Seuls les paramètres réellement supportés par
 * `GET /rnd/aroma-samples` sont représentés ici — jamais `siteId` (toujours
 * dérivé du JWT côté backend, jamais transmis par le frontend).
 */
export interface AromaSamplesListFilters {
  page: number;
  search: string;
  category: string;
  /** 'all' correspond à l'absence de filtre (paramètre `active` omis côté API). */
  active: 'all' | 'true' | 'false';
  sortBy: AromaSampleSortBy;
  sortOrder: AromaSampleSortOrder;
}

export const AROMA_SAMPLES_PAGE_SIZE = 20;

export const DEFAULT_AROMA_SAMPLES_FILTERS: AromaSamplesListFilters = {
  page: 1,
  search: '',
  category: '',
  active: 'all',
  sortBy: 'createdAt',
  sortOrder: 'desc',
};

const VALID_SORT_BY: AromaSampleSortBy[] = ['productName', 'supplierNameRaw', 'addedAt', 'createdAt'];
const VALID_SORT_ORDER: AromaSampleSortOrder[] = ['asc', 'desc'];

/**
 * Construit les paramètres d'URL à partir de l'état de filtre — omet toute
 * valeur égale au défaut, pour une URL propre (`/rnd/aroma-samples` sans
 * paramètre = état par défaut implicite) et un lien partageable minimal.
 */
export function filtersToSearchParams(filters: AromaSamplesListFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.page !== DEFAULT_AROMA_SAMPLES_FILTERS.page) params.set('page', String(filters.page));
  if (filters.search) params.set('search', filters.search);
  if (filters.category) params.set('category', filters.category);
  if (filters.active !== 'all') params.set('active', filters.active);
  if (filters.sortBy !== DEFAULT_AROMA_SAMPLES_FILTERS.sortBy) params.set('sortBy', filters.sortBy);
  if (filters.sortOrder !== DEFAULT_AROMA_SAMPLES_FILTERS.sortOrder) params.set('sortOrder', filters.sortOrder);
  return params;
}

/**
 * Reconstruit l'état de filtre depuis les paramètres d'URL — toute valeur
 * absente ou invalide retombe sur le défaut (jamais d'état frontend
 * indéterminé, jamais de valeur de tri non supportée par l'API).
 */
export function searchParamsToFilters(params: URLSearchParams): AromaSamplesListFilters {
  const pageRaw = Number(params.get('page'));
  const page = Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw : DEFAULT_AROMA_SAMPLES_FILTERS.page;

  const activeRaw = params.get('active');
  const active = activeRaw === 'true' || activeRaw === 'false' ? activeRaw : DEFAULT_AROMA_SAMPLES_FILTERS.active;

  const sortByRaw = params.get('sortBy');
  const sortBy = (VALID_SORT_BY as string[]).includes(sortByRaw ?? '')
    ? (sortByRaw as AromaSampleSortBy)
    : DEFAULT_AROMA_SAMPLES_FILTERS.sortBy;

  const sortOrderRaw = params.get('sortOrder');
  const sortOrder = (VALID_SORT_ORDER as string[]).includes(sortOrderRaw ?? '')
    ? (sortOrderRaw as AromaSampleSortOrder)
    : DEFAULT_AROMA_SAMPLES_FILTERS.sortOrder;

  return {
    page,
    search: params.get('search') ?? DEFAULT_AROMA_SAMPLES_FILTERS.search,
    category: params.get('category') ?? DEFAULT_AROMA_SAMPLES_FILTERS.category,
    active,
    sortBy,
    sortOrder,
  };
}

/**
 * Convertit l'état de filtre en paramètres de requête API — `active` est
 * converti en booléen réel (jamais la chaîne `'all'`), les chaînes vides
 * deviennent `undefined` pour ne pas envoyer de filtre vide au backend.
 */
export function filtersToApiQuery(filters: AromaSamplesListFilters): AromaSamplesQuery {
  return {
    page: filters.page,
    limit: AROMA_SAMPLES_PAGE_SIZE,
    search: filters.search || undefined,
    category: filters.category || undefined,
    active: filters.active === 'all' ? undefined : filters.active === 'true',
    sortBy: filters.sortBy,
    sortOrder: filters.sortOrder,
  };
}
