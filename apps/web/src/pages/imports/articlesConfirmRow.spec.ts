import { describe, expect, it } from 'vitest';
import type { ArticleImportRowWithDiff } from '@lca-mes/shared';
import { toArticlesConfirmRow } from './articlesConfirmRow';

function makeToUpdateRow(): ArticleImportRowWithDiff {
  return {
    line: 3,
    openSiReference: 'MP-LAVANDE',
    type: 'MATIERE_PREMIERE',
    name: 'Parfum ambiance lavande',
    unitOfMeasure: 'KG',
    currentUnitCost: 13.2,
    articleId: 'article-1',
    changes: [{ field: 'unitOfMeasure', label: 'Unité de mesure', before: 'L', after: 'KG' }],
  };
}

describe('toArticlesConfirmRow', () => {
  it('part bien d’une ligne toUpdate contenant articleId et changes', () => {
    const row = makeToUpdateRow();
    expect(row).toHaveProperty('articleId');
    expect(row).toHaveProperty('changes');
  });

  it('ne conserve ni articleId ni changes dans la ligne envoyée à la confirmation', () => {
    const result = toArticlesConfirmRow(makeToUpdateRow());
    expect(result).not.toHaveProperty('articleId');
    expect(result).not.toHaveProperty('changes');
  });

  it('conserve exactement les six champs métier attendus par le DTO backend', () => {
    const result = toArticlesConfirmRow(makeToUpdateRow());
    expect(result).toEqual({
      line: 3,
      openSiReference: 'MP-LAVANDE',
      type: 'MATIERE_PREMIERE',
      name: 'Parfum ambiance lavande',
      unitOfMeasure: 'KG',
      currentUnitCost: 13.2,
    });
    expect(Object.keys(result).sort()).toEqual(
      ['currentUnitCost', 'line', 'name', 'openSiReference', 'type', 'unitOfMeasure'].sort(),
    );
  });

  it('le JSON sérialisé du payload final ne contient ni articleId ni changes', () => {
    const payload = JSON.stringify(toArticlesConfirmRow(makeToUpdateRow()));
    expect(payload).not.toContain('articleId');
    expect(payload).not.toContain('changes');
  });
});
