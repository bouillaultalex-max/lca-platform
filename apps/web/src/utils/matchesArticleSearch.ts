import { ARTICLE_TYPE_LABELS, type Article } from '@lca-mes/shared';
import { normalizeText } from './normalizeText';

/**
 * Recherche instantanée du Catalogue (voir CatalogPage) : insensible à la casse et aux
 * accents, sur la désignation, la référence OpenSi, le nom du fournisseur et le libellé
 * français du type (pas l'enum technique — pour que "matiere" trouve "Matière première").
 * Un terme vide (ou uniquement des espaces) fait correspondre tous les articles.
 */
export function matchesArticleSearch(
  article: Article,
  supplierName: string | null,
  searchTerm: string,
): boolean {
  const term = normalizeText(searchTerm.trim());
  if (!term) return true;

  const haystacks = [
    article.name,
    article.openSiReference,
    supplierName ?? '',
    ARTICLE_TYPE_LABELS[article.type],
  ];
  return haystacks.some((value) => normalizeText(value).includes(term));
}
