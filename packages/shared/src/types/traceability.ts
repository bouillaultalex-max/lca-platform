/**
 * Types partagés du module traceability. Réutilise les types déjà définis
 * (Lot, Batch, Recipe, Article) plutôt que de dupliquer leurs champs — seule la
 * structure d'imbrication renvoyée par GET /traceability/lots/:id est ajoutée.
 */

import type { Article, Recipe } from './catalog';
import type { Batch, Lot } from './production';

export interface LotTraceabilityRecipe extends Recipe {
  finishedProduct: Article;
}

export interface LotTraceabilityBatch extends Batch {
  recipe: LotTraceabilityRecipe;
}

/**
 * Généalogie complète d'un lot fini. Ce ticket n'affiche que les informations
 * générales (numéro, statut qualité, batch, recette, produit fini) — les lignes
 * de généalogie (`genealogyLines`, matières/packaging consommés) existent déjà
 * côté API mais ne sont volontairement pas typées/affichées ici.
 */
export interface LotTraceability extends Lot {
  batch: LotTraceabilityBatch;
}
