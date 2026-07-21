import { describe, expect, it } from 'vitest';
import type { Article } from '@lca-mes/shared';
import {
  getEligibleMarketDeclinations,
  getEligibleStandaloneProducts,
  resolveAllocationMode,
} from './allocationEligibility';

function makeArticle(overrides: Partial<Article> = {}): Article {
  return {
    id: 'article-1',
    type: 'PRODUIT_FINI',
    openSiReference: 'PF-001',
    name: 'Produit',
    unitOfMeasure: 'unité',
    currentUnitCost: '1',
    unitsPerCarton: null,
    densityKgPerL: null,
    supplierId: null,
    productFamilyId: null,
    marketId: null,
    active: true,
    ...overrides,
  };
}

describe('resolveAllocationMode', () => {
  it('returns "market" when the reference product belongs to a commercial family', () => {
    expect(resolveAllocationMode({ productFamilyId: 'family-1' })).toBe('market');
  });

  it('returns "product" when the reference product has no commercial family', () => {
    expect(resolveAllocationMode({ productFamilyId: null })).toBe('product');
  });

  it('returns "product" when the reference product is not yet resolved', () => {
    expect(resolveAllocationMode(null)).toBe('product');
  });
});

describe('getEligibleMarketDeclinations', () => {
  it('returns declinations of the same family with a market, excluding already allocated markets', () => {
    const articles = [
      makeArticle({ id: 'fr', name: 'Lavande FR', productFamilyId: 'family-1', marketId: 'market-fr' }),
      makeArticle({ id: 'ch', name: 'Lavande CH', productFamilyId: 'family-1', marketId: 'market-ch' }),
    ];
    const result = getEligibleMarketDeclinations(articles, 'family-1', ['market-fr']);
    expect(result.map((a) => a.id)).toEqual(['ch']);
  });

  it('returns an empty array when the family has no declination at all', () => {
    const articles = [makeArticle({ id: 'other', productFamilyId: 'family-2', marketId: 'market-fr' })];
    expect(getEligibleMarketDeclinations(articles, 'family-1', [])).toEqual([]);
  });

  it('returns an empty array when every declined market is already allocated', () => {
    const articles = [
      makeArticle({ id: 'fr', productFamilyId: 'family-1', marketId: 'market-fr' }),
      makeArticle({ id: 'ch', productFamilyId: 'family-1', marketId: 'market-ch' }),
    ];
    expect(getEligibleMarketDeclinations(articles, 'family-1', ['market-fr', 'market-ch'])).toEqual([]);
  });

  it('excludes inactive articles', () => {
    const articles = [
      makeArticle({ id: 'ch', productFamilyId: 'family-1', marketId: 'market-ch', active: false }),
    ];
    expect(getEligibleMarketDeclinations(articles, 'family-1', [])).toEqual([]);
  });

  it('excludes articles that are not PRODUIT_FINI', () => {
    const articles = [
      makeArticle({ id: 'ch', type: 'PACKAGING', productFamilyId: 'family-1', marketId: 'market-ch' }),
    ];
    expect(getEligibleMarketDeclinations(articles, 'family-1', [])).toEqual([]);
  });

  it('excludes articles of the family without a market', () => {
    const articles = [makeArticle({ id: 'no-market', productFamilyId: 'family-1', marketId: null })];
    expect(getEligibleMarketDeclinations(articles, 'family-1', [])).toEqual([]);
  });
});

describe('getEligibleStandaloneProducts', () => {
  it('returns active PRODUIT_FINI articles without a commercial family, excluding already allocated products', () => {
    const articles = [
      makeArticle({ id: 'p1', productFamilyId: null }),
      makeArticle({ id: 'p2', productFamilyId: null }),
    ];
    expect(getEligibleStandaloneProducts(articles, ['p1']).map((a) => a.id)).toEqual(['p2']);
  });

  it('excludes products already allocated to this batch, including when all are excluded', () => {
    const articles = [makeArticle({ id: 'p1', productFamilyId: null })];
    expect(getEligibleStandaloneProducts(articles, ['p1'])).toEqual([]);
  });

  it('excludes inactive products', () => {
    const articles = [makeArticle({ id: 'p1', productFamilyId: null, active: false })];
    expect(getEligibleStandaloneProducts(articles, [])).toEqual([]);
  });

  it('excludes articles that are not PRODUIT_FINI', () => {
    const articles = [makeArticle({ id: 'p1', type: 'MATIERE_PREMIERE', productFamilyId: null })];
    expect(getEligibleStandaloneProducts(articles, [])).toEqual([]);
  });

  it('excludes products belonging to a commercial family', () => {
    const articles = [makeArticle({ id: 'p1', productFamilyId: 'family-1' })];
    expect(getEligibleStandaloneProducts(articles, [])).toEqual([]);
  });
});
