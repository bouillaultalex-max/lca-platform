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
  /** Fournisseur principal, matières premières uniquement — un seul par matière en V0.9. */
  supplierId: string | null;
  /** Famille commerciale et marché de déclinaison, PRODUIT_FINI uniquement — voir ADR 0006 (PRD-11). */
  productFamilyId: string | null;
  marketId: string | null;
  active: boolean;
}

export interface CreateArticleRequest {
  type: ArticleType;
  openSiReference: string;
  name: string;
  /** Obligatoire uniquement pour MATIERE_PREMIERE — ignorée pour PACKAGING/PRODUIT_FINI
   * (le serveur y substitue systématiquement la valeur technique "unité"). */
  unitOfMeasure?: string;
  currentUnitCost: number;
  unitsPerCarton?: number;
  densityKgPerL?: number;
  supplierId?: string;
  productFamilyId?: string;
  marketId?: string;
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
  supplierId?: string;
  productFamilyId?: string;
  marketId?: string;
}

export interface Supplier {
  id: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  active: boolean;
}

export interface CreateSupplierRequest {
  name: string;
  contactName?: string;
  phone?: string;
  email?: string;
}

export interface UpdateSupplierRequest {
  name?: string;
  contactName?: string;
  phone?: string;
  email?: string;
}

/** Marché (destination commerciale ou réglementaire) — voir ADR 0006 (PRD-11). */
export interface Market {
  id: string;
  code: string;
  label: string;
  active: boolean;
}

export interface CreateMarketRequest {
  code: string;
  label: string;
}

export interface UpdateMarketRequest {
  code?: string;
  label?: string;
  active?: boolean;
}

/** Famille commerciale : regroupe les déclinaisons d'un même produit par marché — voir ADR 0006 (PRD-11). */
export interface ProductFamily {
  id: string;
  name: string;
  active: boolean;
}

export interface CreateProductFamilyRequest {
  name: string;
}

export interface UpdateProductFamilyRequest {
  name?: string;
  active?: boolean;
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

/**
 * Brouillon de recette (mini-jalon "Brouillons de recettes") : un seul par
 * utilisateur et par produit fini, jamais soumis aux contraintes de `RecipeLine`
 * (une ligne de brouillon peut être partielle/invalide en cours de saisie).
 */
export interface RecipeDraftLine {
  articleId: string | null;
  quantityPerUnit: string | null;
  unit: string | null;
}

export interface RecipeDraft {
  id: string;
  finishedProductId: string;
  content: {
    format: number | null;
    lines: RecipeDraftLine[];
  };
  updatedAt: string;
}

export interface SaveRecipeDraftLineRequest {
  articleId?: string;
  quantityPerUnit?: string;
  unit?: string;
}

export interface SaveRecipeDraftRequest {
  finishedProductId: string;
  format?: number | null;
  lines: SaveRecipeDraftLineRequest[];
  /** `updatedAt` du brouillon tel que connu par cet onglet, pour détecter un conflit. */
  expectedUpdatedAt?: string;
  /** Force l'enregistrement même en cas de conflit détecté (ignore expectedUpdatedAt). */
  force?: boolean;
}
