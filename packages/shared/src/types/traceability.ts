/**
 * Types partagés du module traceability. Réutilise les types déjà définis
 * (Lot, Batch, Recipe, Article, StockLot) plutôt que de dupliquer leurs champs —
 * seule la structure d'imbrication renvoyée par GET /traceability/lots/:id est
 * ajoutée. Comme pour ces types de base, seul un sous-ensemble utile des champs
 * réellement renvoyés par l'API est repris ici (`siteId`/`createdAt`/`updatedAt`
 * de chaque entité, ainsi que les identifiants de relation redondants avec l'objet
 * imbriqué déjà présent, sont omis).
 */

import type { Article, Market, Recipe } from './catalog';
import type { Batch, BatchProductAllocation, Lot } from './production';
import type { StockLot } from './stock';

export interface LotTraceabilityRecipe extends Recipe {
  finishedProduct: Article;
}

export interface LotTraceabilityBatch extends Batch {
  recipe: LotTraceabilityRecipe;
}

/**
 * Allocation d'origine d'un lot (voir ADR 0006, PRD-11) : porte le produit, le
 * marché et la recette réellement attribués au lot. Pour un lot possédant une
 * allocation, ce sont ces valeurs qui doivent être affichées — jamais celles de
 * `batch.recipe` (recette de référence du batch, commune à toutes ses allocations).
 */
export interface LotTraceabilityAllocation extends BatchProductAllocation {
  product: Article;
  market: Market | null;
  /** Sans `lines` : l'API n'inclut pas les lignes de recette de l'allocation. */
  recipe: Omit<Recipe, 'lines'>;
}

/**
 * Ligne de généalogie : un article consommé, prélevé sur un lot fournisseur
 * (`StockLot`) précis. `consumedStockLot` n'est jamais absent : côté API,
 * `LotGenealogy.consumedStockLotId` est une relation obligatoire (voir
 * apps/api/prisma/schema.prisma) — une consommation est toujours affectée à un
 * lot fournisseur précis, jamais globale par article. Le champ réellement
 * optionnel est `consumedStockLot.expiryDate` (péremption du lot fournisseur).
 */
export interface LotGenealogyLine {
  id: string;
  /** Sérialisé en chaîne par l'API (`Decimal` Prisma) — voir la note dans catalog.ts. */
  consumedQuantity: string;
  consumedArticle: Article;
  consumedStockLot: StockLot;
}

/**
 * Généalogie complète d'un lot fini : informations générales (numéro, statut
 * qualité, batch, recette, produit fini) et toutes les lignes de généalogie
 * (matières premières et packaging consommés, avec leur lot fournisseur
 * d'origine) — voir docs/regles-metier.md §2.
 */
export interface LotTraceability extends Lot {
  batch: LotTraceabilityBatch;
  /** `null` pour un lot historique sans allocation : `batch.recipe` reste alors la source. */
  allocation: LotTraceabilityAllocation | null;
  genealogyLines: LotGenealogyLine[];
}

/** Un lot de production ayant consommé le StockLot recherché (traçabilité inverse). */
export interface StockLotConsumingLot extends Lot {
  batch: LotTraceabilityBatch;
  /** Voir `LotTraceability.allocation`. */
  allocation: LotTraceabilityAllocation | null;
}

export interface StockLotGenealogyLine {
  id: string;
  lot: StockLotConsumingLot;
}

/**
 * Traçabilité inverse d'un lot fournisseur (`StockLot`) : tous les lots de
 * production qui l'ont consommé — voir docs/regles-metier.md §2 (capacité de
 * rappel produit dans les deux sens) et TRAC-02.
 */
export interface StockLotTraceability extends StockLot {
  genealogyLines: StockLotGenealogyLine[];
}
