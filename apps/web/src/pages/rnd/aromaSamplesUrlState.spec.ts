import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AROMA_SAMPLES_FILTERS,
  filtersToApiQuery,
  filtersToSearchParams,
  searchParamsToFilters,
} from './aromaSamplesUrlState';

describe('filtersToSearchParams', () => {
  it('produit une URL vide pour l’état par défaut (page=1, tri createdAt desc, aucun filtre)', () => {
    const params = filtersToSearchParams(DEFAULT_AROMA_SAMPLES_FILTERS);
    expect(params.toString()).toBe('');
  });

  it('inclut uniquement les paramètres qui diffèrent du défaut', () => {
    const params = filtersToSearchParams({
      ...DEFAULT_AROMA_SAMPLES_FILTERS,
      page: 3,
      search: 'vanille',
    });
    expect(params.get('page')).toBe('3');
    expect(params.get('search')).toBe('vanille');
    expect(params.has('category')).toBe(false);
    expect(params.has('active')).toBe(false);
    expect(params.has('sortBy')).toBe(false);
    expect(params.has('sortOrder')).toBe(false);
  });

  it('inclut category/active/tri quand ils diffèrent du défaut', () => {
    const params = filtersToSearchParams({
      page: 1,
      search: '',
      category: 'Agrumes',
      active: 'false',
      sortBy: 'productName',
      sortOrder: 'asc',
    });
    expect(params.get('category')).toBe('Agrumes');
    expect(params.get('active')).toBe('false');
    expect(params.get('sortBy')).toBe('productName');
    expect(params.get('sortOrder')).toBe('asc');
    expect(params.has('page')).toBe(false);
  });
});

describe('searchParamsToFilters', () => {
  it('retourne les valeurs par défaut pour une URL vide', () => {
    expect(searchParamsToFilters(new URLSearchParams())).toEqual(DEFAULT_AROMA_SAMPLES_FILTERS);
  });

  it('lit tous les paramètres valides', () => {
    const params = new URLSearchParams(
      'page=2&search=vanille&category=Agrumes&active=true&sortBy=addedAt&sortOrder=asc',
    );
    expect(searchParamsToFilters(params)).toEqual({
      page: 2,
      search: 'vanille',
      category: 'Agrumes',
      active: 'true',
      sortBy: 'addedAt',
      sortOrder: 'asc',
    });
  });

  it('retombe sur le défaut pour une valeur de tri non supportée par l’API (jamais de tri silencieusement ignoré côté serveur)', () => {
    const params = new URLSearchParams('sortBy=rating&sortOrder=DESC');
    const filters = searchParamsToFilters(params);
    expect(filters.sortBy).toBe(DEFAULT_AROMA_SAMPLES_FILTERS.sortBy);
    expect(filters.sortOrder).toBe(DEFAULT_AROMA_SAMPLES_FILTERS.sortOrder);
  });

  it('retombe sur le défaut pour une page invalide (négative, zéro, ou non numérique)', () => {
    expect(searchParamsToFilters(new URLSearchParams('page=0')).page).toBe(1);
    expect(searchParamsToFilters(new URLSearchParams('page=-3')).page).toBe(1);
    expect(searchParamsToFilters(new URLSearchParams('page=abc')).page).toBe(1);
  });

  it('retombe sur le défaut pour une valeur active invalide', () => {
    expect(searchParamsToFilters(new URLSearchParams('active=maybe')).active).toBe('all');
  });

  it('est l’inverse exact de filtersToSearchParams (aller-retour stable)', () => {
    const filters = {
      page: 4,
      search: 'bergamote',
      category: 'Agrumes',
      active: 'true' as const,
      sortBy: 'supplierNameRaw' as const,
      sortOrder: 'asc' as const,
    };
    const roundTripped = searchParamsToFilters(filtersToSearchParams(filters));
    expect(roundTripped).toEqual(filters);
  });
});

describe('filtersToApiQuery', () => {
  it('convertit active="all" en undefined (aucun filtre envoyé à l’API)', () => {
    expect(filtersToApiQuery(DEFAULT_AROMA_SAMPLES_FILTERS).active).toBeUndefined();
  });

  it('convertit active="true"/"false" en booléen réel', () => {
    expect(filtersToApiQuery({ ...DEFAULT_AROMA_SAMPLES_FILTERS, active: 'true' }).active).toBe(true);
    expect(filtersToApiQuery({ ...DEFAULT_AROMA_SAMPLES_FILTERS, active: 'false' }).active).toBe(false);
  });

  it('convertit une recherche/catégorie vide en undefined (jamais un filtre vide envoyé au backend)', () => {
    const query = filtersToApiQuery(DEFAULT_AROMA_SAMPLES_FILTERS);
    expect(query.search).toBeUndefined();
    expect(query.category).toBeUndefined();
  });

  it('transmet page/limit/tri tels quels', () => {
    const query = filtersToApiQuery({
      page: 2,
      search: 'vanille',
      category: 'Épices',
      active: 'all',
      sortBy: 'productName',
      sortOrder: 'asc',
    });
    expect(query).toEqual({
      page: 2,
      limit: 20,
      search: 'vanille',
      category: 'Épices',
      active: undefined,
      sortBy: 'productName',
      sortOrder: 'asc',
    });
  });
});
