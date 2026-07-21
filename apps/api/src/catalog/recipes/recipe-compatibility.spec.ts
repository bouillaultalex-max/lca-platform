import {
  areMaterialFormulasCompatible,
  RecipeForCompatibility,
  RecipeLineForCompatibility,
} from './recipe-compatibility';
import { ArticleType, Prisma } from '../../../generated/prisma/client';

describe('areMaterialFormulasCompatible', () => {
  const materialLine = (
    articleId: string,
    quantityPerUnit: number | string,
  ): RecipeLineForCompatibility => ({
    articleId,
    quantityPerUnit: new Prisma.Decimal(quantityPerUnit),
    article: { type: ArticleType.MATIERE_PREMIERE },
  });

  const packagingLine = (
    articleId: string,
    quantityPerUnit: number | string,
  ): RecipeLineForCompatibility => ({
    articleId,
    quantityPerUnit: new Prisma.Decimal(quantityPerUnit),
    article: { type: ArticleType.PACKAGING },
  });

  const recipe = (
    format: number,
    lines: RecipeLineForCompatibility[],
  ): RecipeForCompatibility => ({ format, lines });

  it('déclare compatibles deux recettes strictement identiques', () => {
    const recipeA = recipe(100, [
      materialLine('article-1', 45.5),
      materialLine('article-2', 54.5),
    ]);
    const recipeB = recipe(100, [
      materialLine('article-1', 45.5),
      materialLine('article-2', 54.5),
    ]);

    expect(areMaterialFormulasCompatible(recipeA, recipeB)).toEqual({
      compatible: true,
    });
  });

  it('ignore l’ordre des lignes (comparaison par ensemble, pas par position)', () => {
    const recipeA = recipe(100, [
      materialLine('article-1', 45.5),
      materialLine('article-2', 54.5),
    ]);
    const recipeB = recipe(100, [
      materialLine('article-2', 54.5),
      materialLine('article-1', 45.5),
    ]);

    expect(areMaterialFormulasCompatible(recipeA, recipeB)).toEqual({
      compatible: true,
    });
  });

  it('rejette un article matière première présent dans A mais absent de B', () => {
    const recipeA = recipe(100, [
      materialLine('article-1', 45.5),
      materialLine('article-2', 54.5),
    ]);
    const recipeB = recipe(100, [materialLine('article-1', 45.5)]);

    expect(areMaterialFormulasCompatible(recipeA, recipeB)).toEqual({
      compatible: false,
      reason: 'MATERIAL_MISMATCH',
      articleId: 'article-2',
    });
  });

  it('rejette un article matière première présent dans B mais absent de A', () => {
    const recipeA = recipe(100, [materialLine('article-1', 45.5)]);
    const recipeB = recipe(100, [
      materialLine('article-1', 45.5),
      materialLine('article-2', 54.5),
    ]);

    expect(areMaterialFormulasCompatible(recipeA, recipeB)).toEqual({
      compatible: false,
      reason: 'MATERIAL_MISMATCH',
      articleId: 'article-2',
    });
  });

  it('rejette une quantité par unité différente pour un même article', () => {
    const recipeA = recipe(100, [materialLine('article-1', 45.5)]);
    const recipeB = recipe(100, [materialLine('article-1', 46)]);

    expect(areMaterialFormulasCompatible(recipeA, recipeB)).toEqual({
      compatible: false,
      reason: 'QUANTITY_MISMATCH',
      articleId: 'article-1',
    });
  });

  it('rejette un format différent, même avec une composition matière première identique', () => {
    const recipeA = recipe(100, [materialLine('article-1', 100)]);
    const recipeB = recipe(200, [materialLine('article-1', 100)]);

    expect(areMaterialFormulasCompatible(recipeA, recipeB)).toEqual({
      compatible: false,
      reason: 'FORMAT_MISMATCH',
    });
  });

  it('ignore les lignes packaging : compatible même si le packaging diffère', () => {
    const recipeA = recipe(100, [
      materialLine('article-1', 100),
      packagingLine('flacon', 1),
    ]);
    const recipeB = recipe(100, [
      materialLine('article-1', 100),
      packagingLine('bouchon-suisse', 1),
    ]);

    expect(areMaterialFormulasCompatible(recipeA, recipeB)).toEqual({
      compatible: true,
    });
  });

  it('déclare compatibles deux recettes sans aucune ligne matière première (même format)', () => {
    const recipeA = recipe(100, [packagingLine('flacon', 1)]);
    const recipeB = recipe(100, [packagingLine('bouchon', 1)]);

    expect(areMaterialFormulasCompatible(recipeA, recipeB)).toEqual({
      compatible: true,
    });
  });

  it('applique une égalité stricte des Decimal, sans tolérance numérique', () => {
    const recipeA = recipe(100, [materialLine('article-1', '45.5')]);
    const recipeBEquivalent = recipe(100, [materialLine('article-1', '45.50')]);
    const recipeBSlightlyDifferent = recipe(100, [
      materialLine('article-1', '45.500001'),
    ]);

    expect(areMaterialFormulasCompatible(recipeA, recipeBEquivalent)).toEqual({
      compatible: true,
    });
    expect(
      areMaterialFormulasCompatible(recipeA, recipeBSlightlyDifferent),
    ).toEqual({
      compatible: false,
      reason: 'QUANTITY_MISMATCH',
      articleId: 'article-1',
    });
  });
});
