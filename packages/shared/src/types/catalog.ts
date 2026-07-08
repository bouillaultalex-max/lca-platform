/**
 * Types partagés du module catalog (Article/Recipe).
 * Doit rester synchronisé avec apps/api/prisma/schema.prisma (source de vérité) —
 * voir la note dans user-role.ts sur la raison de cette duplication manuelle.
 *
 * Les champs numériques `Decimal` de Prisma (coûts, quantités) sont sérialisés en
 * chaîne de caractères par l'API : côté frontend, ils sont donc typés `string` en
 * lecture et `number` en écriture (payload de création).
 */

export type ArticleType = 'MATIERE_PREMIERE' | 'PACKAGING' | 'PRODUIT_FINI';

export const ARTICLE_TYPE_LABELS: Record<ArticleType, string> = {
  MATIERE_PREMIERE: 'Matière première',
  PACKAGING: 'Packaging',
  PRODUIT_FINI: 'Produit fini',
};

export interface Article {
  id: string;
  type: ArticleType;
  openSiReference: string;
  name: string;
  unitOfMeasure: string;
  currentUnitCost: string;
  /** Conditionnement en carton, affichage uniquement (voir docs/roadmap.md). */
  unitsPerCarton: number | null;
  /** Densité (kg/L), matières premières uniquement — voir docs/regles-metier.md §12. */
  densityKgPerL: string | null;
  active: boolean;
}

export interface CreateArticleRequest {
  type: ArticleType;
  openSiReference: string;
  name: string;
  unitOfMeasure: string;
  currentUnitCost: number;
  unitsPerCarton?: number;
  densityKgPerL?: number;
}

/**
 * Le type d'article n'est modifiable que si l'article n'a jamais été utilisé
 * (aucune recette, aucun stock, aucune généalogie) — voir ArticlesService.update()
 * backend, qui refuse la requête avec un message explicite dans le cas contraire.
 */
export interface UpdateArticleRequest {
  type?: ArticleType;
  openSiReference?: string;
  name?: string;
  unitOfMeasure?: string;
  currentUnitCost?: number;
  unitsPerCarton?: number;
  densityKgPerL?: number;
}

export interface Machine {
  id: string;
  name: string;
  supportedFormats: number[];
  active: boolean;
}

export interface CreateMachineRequest {
  name: string;
  supportedFormats: number[];
}

export interface UpdateMachineRequest {
  name?: string;
  supportedFormats?: number[];
}

export type RecipeStatus = 'ACTIVE' | 'ARCHIVEE';

export interface RecipeLine {
  id: string;
  articleId: string;
  quantityPerUnit: string;
  unit: string;
}

export interface Recipe {
  id: string;
  finishedProductId: string;
  format: number;
  version: number;
  status: RecipeStatus;
  lines: RecipeLine[];
}

export interface CreateRecipeLineRequest {
  articleId: string;
  quantityPerUnit: number;
  unit: string;
}

export interface CreateRecipeRequest {
  finishedProductId: string;
  format: number;
  lines: CreateRecipeLineRequest[];
}
