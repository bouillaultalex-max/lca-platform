import { describe, expect, it } from 'vitest';
import type { Article } from '@lca-mes/shared';
import { matchesIngredientSearch } from './matchesIngredientSearch';

function makeArticle(overrides: Partial<Article> = {}): Article {
  return {
    id: 'article-1',
    type: 'MATIERE_PREMIERE',
    openSiReference: 'MP-LAVANDE-001',
    name: 'Parfum ambiance lavande',
    unitOfMeasure: 'L',
    currentUnitCost: '12.5',
    unitsPerCarton: null,
    densityKgPerL: null,
    supplierId: null,
    active: true,
    ...overrides,
  };
}

describe('matchesIngredientSearch', () => {
  it('fait correspondre tous les articles quand le terme est vide', () => {
    expect(matchesIngredientSearch(makeArticle(), null, '')).toBe(true);
  });

  it('fait correspondre tous les articles quand le terme ne contient que des espaces', () => {
    expect(matchesIngredientSearch(makeArticle(), null, '   ')).toBe(true);
  });

  it('trouve par désignation', () => {
    expect(matchesIngredientSearch(makeArticle({ name: 'Parfum ambiance lavande' }), null, 'ambiance')).toBe(true);
  });

  it('trouve par référence OpenSi', () => {
    expect(matchesIngredientSearch(makeArticle({ openSiReference: 'MP-LAVANDE-001' }), null, 'lavande-001')).toBe(
      true,
    );
  });

  it('trouve par nom de fournisseur', () => {
    expect(matchesIngredientSearch(makeArticle(), 'Selectarome', 'select')).toBe(true);
  });

  it('ne plante pas et ne matche pas quand il n’y a pas de fournisseur', () => {
    expect(matchesIngredientSearch(makeArticle({ name: 'Autre chose' }), null, 'selectarome')).toBe(false);
  });

  it('ne recherche pas sur le type, contrairement au Catalogue', () => {
    expect(matchesIngredientSearch(makeArticle({ type: 'MATIERE_PREMIERE' }), null, 'matière première')).toBe(false);
    expect(matchesIngredientSearch(makeArticle({ type: 'PACKAGING' }), null, 'packaging')).toBe(false);
  });

  it('trouve la désignation même sans accent dans le terme saisi', () => {
    expect(matchesIngredientSearch(makeArticle({ name: 'Décoction de thé vert' }), null, 'decoction')).toBe(true);
  });

  it('est insensible à la casse', () => {
    expect(matchesIngredientSearch(makeArticle({ name: 'Parfum Ambiance Lavande' }), null, 'AMBIANCE')).toBe(true);
    expect(matchesIngredientSearch(makeArticle({ name: 'parfum ambiance lavande' }), null, 'Lavande')).toBe(true);
  });

  it('ignore les espaces au début et à la fin du terme', () => {
    expect(matchesIngredientSearch(makeArticle({ name: 'Parfum ambiance lavande' }), null, '   lavande   ')).toBe(
      true,
    );
  });

  it('retourne false quand aucun champ ne correspond', () => {
    expect(
      matchesIngredientSearch(
        makeArticle({ name: 'Parfum ambiance lavande', openSiReference: 'MP-LAVANDE-001' }),
        'Selectarome',
        'zzz-introuvable',
      ),
    ).toBe(false);
  });
});
