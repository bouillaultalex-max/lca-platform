import { describe, expect, it } from 'vitest';
import { resetUnitOfMeasureOnTypeChange } from './resetUnitOfMeasureOnTypeChange';

describe('resetUnitOfMeasureOnTypeChange', () => {
  it('leaves unitOfMeasure untouched when the new type is MATIERE_PREMIERE', () => {
    const form = { unitOfMeasure: 'L', name: 'x' };
    expect(resetUnitOfMeasureOnTypeChange(form, 'MATIERE_PREMIERE')).toEqual(form);
  });

  it('clears unitOfMeasure when the new type is PACKAGING', () => {
    const form = { unitOfMeasure: 'L', name: 'x' };
    expect(resetUnitOfMeasureOnTypeChange(form, 'PACKAGING')).toEqual({
      unitOfMeasure: '',
      name: 'x',
    });
  });

  it('clears unitOfMeasure when the new type is PRODUIT_FINI', () => {
    const form = { unitOfMeasure: 'L', name: 'x' };
    expect(resetUnitOfMeasureOnTypeChange(form, 'PRODUIT_FINI')).toEqual({
      unitOfMeasure: '',
      name: 'x',
    });
  });

  it('is a no-op when the field is already empty', () => {
    const form = { unitOfMeasure: '', name: 'x' };
    expect(resetUnitOfMeasureOnTypeChange(form, 'PACKAGING')).toEqual(form);
  });
});
