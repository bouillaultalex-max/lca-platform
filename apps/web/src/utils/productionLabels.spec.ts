import { describe, expect, it } from 'vitest';
import type { Batch, BatchPrintData, IngredientQuantity } from '@lca-mes/shared';
import { buildPrintLabels, canPrintBatchLabels } from './productionLabels';

function pgLine(volumeL: number): IngredientQuantity {
  return {
    kind: 'MATIERE_PREMIERE',
    articleId: 'art-pg',
    articleName: 'Monopropylène glycol (PG)',
    articleReference: 'PG-001',
    volumeL,
    massKg: null,
  };
}

function vgLine(volumeL: number): IngredientQuantity {
  return {
    kind: 'MATIERE_PREMIERE',
    articleId: 'art-vg',
    articleName: 'Glycérine végétale (VG)',
    articleReference: 'VG-001',
    volumeL,
    massKg: null,
  };
}

function packagingLine(quantity: number): IngredientQuantity {
  return {
    kind: 'PACKAGING',
    articleId: 'art-flacon',
    articleName: 'Flacon 100 ml',
    articleReference: 'FLA-100',
    quantity,
    unit: 'unité',
  };
}

describe('buildPrintLabels (ADR 0010 § Décisions 16/17)', () => {
  it('produit exactement deux étiquettes (PRODUIT puis BATCHING) pour une seule allocation', () => {
    const data: BatchPrintData = {
      batchId: 'batch-1',
      lotNumber: '456149',
      expiryDate: '2029-08-24T00:00:00.000Z',
      allocations: [
        {
          allocationId: 'alloc-A',
          productName: 'Produit A',
          quantityToBatch: 300,
          ingredients: [pgLine(18), vgLine(12), packagingLine(300)],
        },
      ],
    };

    const labels = buildPrintLabels(data);

    expect(labels).toHaveLength(2);
    expect(labels.map((l) => l.kind)).toEqual(['PRODUIT', 'BATCHING']);
  });

  it('produit N × 2 étiquettes pour N allocations (2 allocations → 4 étiquettes)', () => {
    const data: BatchPrintData = {
      batchId: 'batch-1',
      lotNumber: '456149',
      expiryDate: '2029-08-24T00:00:00.000Z',
      allocations: [
        { allocationId: 'alloc-A', productName: 'Produit A', quantityToBatch: 300, ingredients: [] },
        { allocationId: 'alloc-B', productName: 'Produit B', quantityToBatch: 150, ingredients: [] },
      ],
    };

    const labels = buildPrintLabels(data);

    expect(labels).toHaveLength(4);
  });

  it('propage le même lotNumber/DDM à toutes les étiquettes, jamais recalculés', () => {
    const data: BatchPrintData = {
      batchId: 'batch-1',
      lotNumber: '456149',
      expiryDate: '2029-08-24T00:00:00.000Z',
      allocations: [
        { allocationId: 'alloc-A', productName: 'Produit A', quantityToBatch: 300, ingredients: [] },
        { allocationId: 'alloc-B', productName: 'Produit B', quantityToBatch: 150, ingredients: [] },
      ],
    };

    const labels = buildPrintLabels(data);

    expect(labels.every((l) => l.lotNumber === '456149')).toBe(true);
    expect(labels.every((l) => l.expiryDate === '2029-08-24T00:00:00.000Z')).toBe(true);
  });

  it('conserve productName/quantityToBatch/ingredients propres à chaque allocation, jamais fusionnés', () => {
    const data: BatchPrintData = {
      batchId: 'batch-1',
      lotNumber: '456149',
      expiryDate: '2029-08-24T00:00:00.000Z',
      allocations: [
        { allocationId: 'alloc-A', productName: 'Produit A', quantityToBatch: 300, ingredients: [pgLine(18)] },
        { allocationId: 'alloc-B', productName: 'Produit B', quantityToBatch: 150, ingredients: [vgLine(6)] },
      ],
    };

    const labels = buildPrintLabels(data);
    const batchingA = labels.find((l) => l.allocationId === 'alloc-A' && l.kind === 'BATCHING')!;
    const batchingB = labels.find((l) => l.allocationId === 'alloc-B' && l.kind === 'BATCHING')!;

    expect(batchingA.productName).toBe('Produit A');
    expect(batchingA.quantityToBatch).toBe(300);
    expect(batchingA.ingredients).toEqual([pgLine(18)]);
    expect(batchingB.productName).toBe('Produit B');
    expect(batchingB.quantityToBatch).toBe(150);
    expect(batchingB.ingredients).toEqual([vgLine(6)]);
  });

  it('PG et VG sont présents tels quels dans les ingrédients de l’étiquette BATCHING, sans traitement spécial', () => {
    const data: BatchPrintData = {
      batchId: 'batch-1',
      lotNumber: '456149',
      expiryDate: '2029-08-24T00:00:00.000Z',
      allocations: [
        {
          allocationId: 'alloc-A',
          productName: 'Produit A',
          quantityToBatch: 300,
          ingredients: [pgLine(18), vgLine(12), packagingLine(300)],
        },
      ],
    };

    const [, batching] = buildPrintLabels(data);

    expect(batching.ingredients).toContainEqual(pgLine(18));
    expect(batching.ingredients).toContainEqual(vgLine(12));
    expect(batching.ingredients).toContainEqual(packagingLine(300));
  });

  it('génère des id stables et distincts, jamais lotNumber ni un index de tableau', () => {
    const data: BatchPrintData = {
      batchId: 'batch-1',
      lotNumber: '456149', // identique pour toutes les allocations
      expiryDate: '2029-08-24T00:00:00.000Z',
      allocations: [
        { allocationId: 'alloc-A', productName: 'Produit A', quantityToBatch: 300, ingredients: [] },
        { allocationId: 'alloc-B', productName: 'Produit B', quantityToBatch: 150, ingredients: [] },
      ],
    };

    const labels = buildPrintLabels(data);
    const ids = labels.map((l) => l.id);

    expect(new Set(ids).size).toBe(ids.length); // tous distincts
    expect(ids.every((id) => !id.includes('456149'))).toBe(true); // jamais dérivé de lotNumber
  });

  it('gère le repli historique (allocationId null) sans collision d’id', () => {
    const data: BatchPrintData = {
      batchId: 'batch-1',
      lotNumber: '456149',
      expiryDate: '2029-08-24T00:00:00.000Z',
      allocations: [
        { allocationId: null, productName: 'Produit de référence', quantityToBatch: 500, ingredients: [] },
      ],
    };

    const labels = buildPrintLabels(data);

    expect(labels).toHaveLength(2);
    expect(new Set(labels.map((l) => l.id)).size).toBe(2);
    expect(labels.every((l) => l.allocationId === null)).toBe(true);
  });
});

describe('canPrintBatchLabels (ADR 0010, étape 7)', () => {
  function batch(overrides: Partial<Batch>): Pick<Batch, 'status' | 'reservedLotNumber' | 'reservedExpiryDate'> {
    return {
      status: 'EN_COURS',
      reservedLotNumber: '456149',
      reservedExpiryDate: '2029-08-24T00:00:00.000Z',
      ...overrides,
    };
  }

  it('autorise EN_COURS avec réservation complète', () => {
    expect(canPrintBatchLabels(batch({}))).toBe(true);
  });

  it('refuse PLANIFIE', () => {
    expect(canPrintBatchLabels(batch({ status: 'PLANIFIE' }))).toBe(false);
  });

  it('refuse ANNULE', () => {
    expect(canPrintBatchLabels(batch({ status: 'ANNULE' }))).toBe(false);
  });

  it('refuse TERMINE', () => {
    expect(canPrintBatchLabels(batch({ status: 'TERMINE' }))).toBe(false);
  });

  it('refuse EN_COURS sans réservation (repli legacy)', () => {
    expect(
      canPrintBatchLabels(batch({ reservedLotNumber: null, reservedExpiryDate: null })),
    ).toBe(false);
  });

  it('refuse EN_COURS avec reservedLotNumber seul (état incohérent)', () => {
    expect(canPrintBatchLabels(batch({ reservedExpiryDate: null }))).toBe(false);
  });

  it('refuse EN_COURS avec reservedExpiryDate seule (état incohérent)', () => {
    expect(canPrintBatchLabels(batch({ reservedLotNumber: null }))).toBe(false);
  });
});
