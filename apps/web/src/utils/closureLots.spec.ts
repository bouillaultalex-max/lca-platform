import { describe, expect, it } from 'vitest';
import type { Article, Batch, BatchClosureResult, BatchProductAllocation, Lot, Market } from '@lca-mes/shared';
import { enrichClosureLots, resolveClosureLots } from './closureLots';

function makeLot(overrides: Partial<Lot> = {}): Lot {
  return {
    id: 'lot-1',
    batchId: 'batch-1',
    allocationId: null,
    lotNumber: 'LOT-0001',
    quantity: 100,
    manufacturedAt: '2026-07-22T10:00:00.000Z',
    expiryDate: null,
    qualityStatus: 'EN_ATTENTE',
    ...overrides,
  };
}

function makeAllocation(overrides: Partial<BatchProductAllocation> = {}): BatchProductAllocation {
  return {
    id: 'alloc-1',
    batchId: 'batch-1',
    productId: 'product-1',
    recipeId: 'recipe-1',
    marketId: null,
    plannedQuantity: 100,
    producedQuantity: null,
    rejectedQuantity: null,
    createdAt: '2026-07-22T09:00:00.000Z',
    ...overrides,
  };
}

function makeArticle(overrides: Partial<Article> = {}): Article {
  return {
    id: 'product-1',
    type: 'PRODUIT_FINI',
    openSiReference: 'PF-001',
    name: 'Recharge Lavande',
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

function makeMarket(overrides: Partial<Market> = {}): Market {
  return { id: 'market-1', code: 'FR', label: 'France', active: true, ...overrides };
}

const batchStub = {} as Batch;

describe('resolveClosureLots', () => {
  it('returns lots[] when present and non-empty', () => {
    const result: BatchClosureResult = {
      batch: batchStub,
      lots: [makeLot({ lotNumber: 'A' }), makeLot({ lotNumber: 'B' })],
      lot: makeLot({ lotNumber: 'A' }),
    };
    expect(resolveClosureLots(result).map((l) => l.lotNumber)).toEqual(['A', 'B']);
  });

  it('falls back defensively to [lot] when lots is empty', () => {
    const result: BatchClosureResult = {
      batch: batchStub,
      lots: [],
      lot: makeLot({ lotNumber: 'FALLBACK' }),
    };
    expect(resolveClosureLots(result).map((l) => l.lotNumber)).toEqual(['FALLBACK']);
  });

  it('falls back defensively to [lot] when lots is not an array', () => {
    const result = { batch: batchStub, lots: undefined, lot: makeLot({ lotNumber: 'FALLBACK' }) } as unknown as BatchClosureResult;
    expect(resolveClosureLots(result).map((l) => l.lotNumber)).toEqual(['FALLBACK']);
  });
});

describe('enrichClosureLots', () => {
  it('resolves product and market for a lot tied to an allocation', () => {
    const lots = [makeLot({ allocationId: 'alloc-1' })];
    const allocations = [makeAllocation({ id: 'alloc-1', productId: 'product-1', marketId: 'market-1' })];
    const articlesById = new Map([['product-1', makeArticle({ id: 'product-1', name: 'Recharge Lavande FR' })]]);
    const marketsById = new Map([['market-1', makeMarket()]]);

    expect(enrichClosureLots(lots, allocations, articlesById, marketsById)).toEqual([
      {
        id: 'lot-1',
        allocationId: 'alloc-1',
        lotNumber: 'LOT-0001',
        quantity: 100,
        productName: 'Recharge Lavande FR',
        marketLabel: 'France',
      },
    ]);
  });

  it('returns null product/market for a historical lot (no allocation)', () => {
    const lots = [makeLot({ allocationId: null })];
    expect(enrichClosureLots(lots, [], new Map(), new Map())).toEqual([
      {
        id: 'lot-1',
        allocationId: null,
        lotNumber: 'LOT-0001',
        quantity: 100,
        productName: null,
        marketLabel: null,
      },
    ]);
  });

  it('returns null market when the allocation has no market', () => {
    const lots = [makeLot({ allocationId: 'alloc-1' })];
    const allocations = [makeAllocation({ id: 'alloc-1', productId: 'product-1', marketId: null })];
    const articlesById = new Map([['product-1', makeArticle()]]);

    const enriched = enrichClosureLots(lots, allocations, articlesById, new Map());
    expect(enriched[0].productName).toBe('Recharge Lavande');
    expect(enriched[0].marketLabel).toBeNull();
  });

  it('degrades gracefully when the allocation referenced by the lot is not found', () => {
    const lots = [makeLot({ allocationId: 'missing-alloc' })];
    expect(enrichClosureLots(lots, [], new Map(), new Map())).toEqual([
      {
        id: 'lot-1',
        allocationId: 'missing-alloc',
        lotNumber: 'LOT-0001',
        quantity: 100,
        productName: null,
        marketLabel: null,
      },
    ]);
  });

  it('preserves the order and count of multiple lots', () => {
    const lots = [
      makeLot({ lotNumber: 'A', allocationId: 'alloc-1' }),
      makeLot({ lotNumber: 'B', allocationId: 'alloc-2' }),
    ];
    const allocations = [
      makeAllocation({ id: 'alloc-1', productId: 'product-1' }),
      makeAllocation({ id: 'alloc-2', productId: 'product-2' }),
    ];
    const articlesById = new Map([
      ['product-1', makeArticle({ id: 'product-1', name: 'Produit A' })],
      ['product-2', makeArticle({ id: 'product-2', name: 'Produit B' })],
    ]);

    const enriched = enrichClosureLots(lots, allocations, articlesById, new Map());
    expect(enriched.map((l) => l.lotNumber)).toEqual(['A', 'B']);
    expect(enriched.map((l) => l.productName)).toEqual(['Produit A', 'Produit B']);
  });

  it('propagates a distinct id per Lot even when lotNumber is shared across a multi-allocation batch (ADR 0010 § Décision 15)', () => {
    const lots = [
      makeLot({ id: 'lot-1', lotNumber: 'LOT-SHARED', allocationId: 'alloc-1' }),
      makeLot({ id: 'lot-2', lotNumber: 'LOT-SHARED', allocationId: 'alloc-2' }),
    ];
    const allocations = [
      makeAllocation({ id: 'alloc-1', productId: 'product-1' }),
      makeAllocation({ id: 'alloc-2', productId: 'product-2' }),
    ];
    const articlesById = new Map([
      ['product-1', makeArticle({ id: 'product-1', name: 'Produit A' })],
      ['product-2', makeArticle({ id: 'product-2', name: 'Produit B' })],
    ]);

    const enriched = enrichClosureLots(lots, allocations, articlesById, new Map());

    expect(enriched.map((l) => l.lotNumber)).toEqual(['LOT-SHARED', 'LOT-SHARED']);
    expect(enriched.map((l) => l.id)).toEqual(['lot-1', 'lot-2']);
    expect(new Set(enriched.map((l) => l.id)).size).toBe(2);
    expect(enriched.map((l) => l.allocationId)).toEqual(['alloc-1', 'alloc-2']);
  });
});
