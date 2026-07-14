import { describe, expect, it } from 'vitest';
import type { Article } from '@lca-mes/shared';
import { matchesArticleSearch } from './matchesArticleSearch';

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

describe('matchesArticleSearch', () => {
  it('fait correspondre tous les articles quand le terme est vide', () => {
    expect(matchesArticleSearch(makeArticle(), null, '')).toBe(true);
  });

  it('fait correspondre tous les articles quand le terme ne contient que des espaces', () => {
    expect(matchesArticleSearch(makeArticle(), null, '   ')).toBe(true);
  });

  it('trouve par désignation', () => {
    expect(matchesArticleSearch(makeArticle({ name: 'Parfum ambiance lavande' }), null, 'ambiance')).toBe(true);
  });

  it('trouve par référence OpenSi', () => {
    expect(matchesArticleSearch(makeArticle({ openSiReference: 'MP-LAVANDE-001' }), null, 'lavande-001')).toBe(true);
  });

  it('trouve par nom de fournisseur', () => {
    expect(matchesArticleSearch(makeArticle(), 'Selectarome', 'select')).toBe(true);
  });

  it('ne plante pas et ne matche pas quand il n’y a pas de fournisseur', () => {
    expect(matchesArticleSearch(makeArticle({ name: 'Autre chose' }), null, 'selectarome')).toBe(false);
  });

  it('trouve par libellé français du type, pas par l’enum technique', () => {
    expect(matchesArticleSearch(makeArticle({ type: 'MATIERE_PREMIERE' }), null, 'matière première')).toBe(true);
    expect(matchesArticleSearch(makeArticle({ type: 'MATIERE_PREMIERE' }), null, 'MATIERE_PREMIERE')).toBe(false);
  });

  it('trouve le type même sans accent dans le terme saisi', () => {
    expect(matchesArticleSearch(makeArticle({ type: 'MATIERE_PREMIERE' }), null, 'matiere')).toBe(true);
  });

  it('trouve la désignation même sans accent dans le terme saisi', () => {
    expect(matchesArticleSearch(makeArticle({ name: 'Décoction de thé vert' }), null, 'decoction')).toBe(true);
  });

  it('est insensible à la casse', () => {
    expect(matchesArticleSearch(makeArticle({ name: 'Parfum Ambiance Lavande' }), null, 'AMBIANCE')).toBe(true);
    expect(matchesArticleSearch(makeArticle({ name: 'parfum ambiance lavande' }), null, 'Lavande')).toBe(true);
  });

  it('ignore les espaces au début et à la fin du terme', () => {
    expect(matchesArticleSearch(makeArticle({ name: 'Parfum ambiance lavande' }), null, '   lavande   ')).toBe(true);
  });

  it('retourne false quand aucun champ ne correspond', () => {
    expect(
      matchesArticleSearch(
        makeArticle({ name: 'Parfum ambiance lavande', openSiReference: 'MP-LAVANDE-001' }),
        'Selectarome',
        'zzz-introuvable',
      ),
    ).toBe(false);
  });

  it('trouve packaging (avec accent sur aucune lettre, cas simple)', () => {
    expect(matchesArticleSearch(makeArticle({ type: 'PACKAGING' }), null, 'packaging')).toBe(true);
  });

  it('trouve produit fini avec ou sans accent', () => {
    const article = makeArticle({ type: 'PRODUIT_FINI' });
    expect(matchesArticleSearch(article, null, 'produit fini')).toBe(true);
    expect(matchesArticleSearch(article, null, 'PRODUIT FINI')).toBe(true);
  });
});
