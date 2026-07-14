import type { Article } from '@lca-mes/shared';
import { normalizeText } from './normalizeText';

/**
 * Recherche instantanée du sélecteur d'ingrédient dans les recettes (voir ArticleSearchSelect) :
 * insensible à la casse et aux accents, sur la désignation, la référence OpenSi et le nom du
 * fournisseur uniquement — contrairement à matchesArticleSearch (Catalogue), le type n'est pas
 * un champ de recherche ici (retour Kevin). Un terme vide fait correspondre tous les articles.
 */
export function matchesIngredientSearch(
  article: Article,
  supplierName: string | null,
  searchTerm: string,
): boolean {
  const term = normalizeText(searchTerm.trim());
  if (!term) return true;

  const haystacks = [article.name, article.openSiReference, supplierName ?? ''];
  return haystacks.some((value) => normalizeText(value).includes(term));
}
