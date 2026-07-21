import { ArticleType, Prisma } from '../../../generated/prisma/client';

export interface RecipeLineForCompatibility {
  articleId: string;
  quantityPerUnit: Prisma.Decimal;
  article: {
    type: ArticleType;
  };
}

export interface RecipeForCompatibility {
  format: number;
  lines: RecipeLineForCompatibility[];
}

export type RecipeCompatibilityResult =
  | {
      compatible: true;
    }
  | {
      compatible: false;
      reason: 'FORMAT_MISMATCH' | 'MATERIAL_MISMATCH' | 'QUANTITY_MISMATCH';
      articleId?: string;
    };

/**
 * Compare la composition matière première de deux recettes (voir décision métier
 * n°17 et ADR 0006 invariant 5) : compatibles si le format et l'ensemble des lignes
 * MATIERE_PREMIERE (article + quantité par unité) sont strictement identiques.
 * Les lignes PACKAGING et le champ `unit` ne sont jamais comparés. Fonction pure,
 * aucun accès Prisma : les recettes doivent être chargées avec leurs lignes et le
 * type de l'article de chaque ligne par l'appelant.
 */
export function areMaterialFormulasCompatible(
  recipeA: RecipeForCompatibility,
  recipeB: RecipeForCompatibility,
): RecipeCompatibilityResult {
  if (recipeA.format !== recipeB.format) {
    return { compatible: false, reason: 'FORMAT_MISMATCH' };
  }

  const materialsA = materialLinesByArticleId(recipeA);
  const materialsB = materialLinesByArticleId(recipeB);

  for (const [articleId] of materialsA) {
    if (!materialsB.has(articleId)) {
      return { compatible: false, reason: 'MATERIAL_MISMATCH', articleId };
    }
  }
  for (const [articleId] of materialsB) {
    if (!materialsA.has(articleId)) {
      return { compatible: false, reason: 'MATERIAL_MISMATCH', articleId };
    }
  }

  for (const [articleId, quantityA] of materialsA) {
    const quantityB = materialsB.get(articleId)!;
    if (!quantityA.equals(quantityB)) {
      return { compatible: false, reason: 'QUANTITY_MISMATCH', articleId };
    }
  }

  return { compatible: true };
}

function materialLinesByArticleId(
  recipe: RecipeForCompatibility,
): Map<string, Prisma.Decimal> {
  return new Map(
    recipe.lines
      .filter((line) => line.article.type === ArticleType.MATIERE_PREMIERE)
      .map((line) => [line.articleId, line.quantityPerUnit]),
  );
}
