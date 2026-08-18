import { describe, expect, it } from 'vitest';
import type { AromaSampleImportRowWithStatus } from '@lca-mes/shared';
import { toAromaSampleConfirmRow } from './aromaSamplesConfirmRow';

function makeUpdateRow(): AromaSampleImportRowWithStatus {
  return {
    line: 7,
    legacyId: 'EF-0378-00042',
    supplierNameRaw: 'Fournisseur Aromatique SA',
    productName: 'Vanille Bourbon',
    supplierReference: null,
    category: 'Autre',
    rating: null,
    stockGrams: 250,
    pricePerKgEur: null,
    addedAt: '2026-07-06',
    comment: null,
    status: 'update',
    sampleId: 'sample-1',
    changes: [{ field: 'stockGrams', label: 'Stock (g)', before: 200, after: 250 }],
  };
}

describe('toAromaSampleConfirmRow', () => {
  it('part bien d’une ligne portant status/sampleId/changes', () => {
    const row = makeUpdateRow();
    expect(row).toHaveProperty('status');
    expect(row).toHaveProperty('sampleId');
    expect(row).toHaveProperty('changes');
  });

  it('ne conserve ni status, ni sampleId, ni changes dans la ligne envoyée à la confirmation', () => {
    const result = toAromaSampleConfirmRow(makeUpdateRow());
    expect(result).not.toHaveProperty('status');
    expect(result).not.toHaveProperty('sampleId');
    expect(result).not.toHaveProperty('changes');
  });

  it('convertit les champs null en undefined (le DTO backend attend des champs optionnels, jamais null)', () => {
    const result = toAromaSampleConfirmRow(makeUpdateRow());
    expect(result.supplierReference).toBeUndefined();
    expect(result.rating).toBeUndefined();
    expect(result.pricePerKgEur).toBeUndefined();
    expect(result.comment).toBeUndefined();
  });

  it('conserve les valeurs non nulles telles quelles', () => {
    const result = toAromaSampleConfirmRow(makeUpdateRow());
    expect(result).toEqual({
      line: 7,
      legacyId: 'EF-0378-00042',
      supplierNameRaw: 'Fournisseur Aromatique SA',
      productName: 'Vanille Bourbon',
      category: 'Autre',
      stockGrams: 250,
      addedAt: '2026-07-06',
    });
  });

  it('le JSON sérialisé du payload final ne contient ni status, ni sampleId, ni changes', () => {
    const payload = JSON.stringify(toAromaSampleConfirmRow(makeUpdateRow()));
    expect(payload).not.toContain('status');
    expect(payload).not.toContain('sampleId');
    expect(payload).not.toContain('changes');
  });
});
