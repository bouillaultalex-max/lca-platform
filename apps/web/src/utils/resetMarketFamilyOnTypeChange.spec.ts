import { describe, expect, it } from 'vitest';
import { resetMarketFamilyOnTypeChange } from './resetMarketFamilyOnTypeChange';

describe('resetMarketFamilyOnTypeChange', () => {
  it('leaves productFamilyId/marketId untouched when the new type is PRODUIT_FINI', () => {
    const form = { productFamilyId: 'family-1', marketId: 'market-1', name: 'x' };
    expect(resetMarketFamilyOnTypeChange(form, 'PRODUIT_FINI')).toEqual(form);
  });

  it('clears productFamilyId/marketId when the new type is MATIERE_PREMIERE', () => {
    const form = { productFamilyId: 'family-1', marketId: 'market-1', name: 'x' };
    expect(resetMarketFamilyOnTypeChange(form, 'MATIERE_PREMIERE')).toEqual({
      productFamilyId: '',
      marketId: '',
      name: 'x',
    });
  });

  it('clears productFamilyId/marketId when the new type is PACKAGING', () => {
    const form = { productFamilyId: 'family-1', marketId: 'market-1', name: 'x' };
    expect(resetMarketFamilyOnTypeChange(form, 'PACKAGING')).toEqual({
      productFamilyId: '',
      marketId: '',
      name: 'x',
    });
  });

  it('is a no-op when both fields are already empty', () => {
    const form = { productFamilyId: '', marketId: '', name: 'x' };
    expect(resetMarketFamilyOnTypeChange(form, 'MATIERE_PREMIERE')).toEqual(form);
  });
});
