/**
 * Recherche mémoire, insensible à la casse et aux accents, sur le nom ou la
 * référence OpenSi d'un article. Aucune fonction équivalente n'existe dans
 * `catalog/articles` (ArticlesService.findAll ne prend qu'un filtre de type,
 * voir AI-03) — cette fonction reste volontairement pure : aucun appel Prisma,
 * aucune logique métier, uniquement un filtrage en mémoire sur des données déjà
 * chargées par un service existant.
 */

interface SearchableArticle {
  name: string;
  openSiReference: string;
}

const COMBINING_DIACRITICAL_MARKS_START = 0x0300;
const COMBINING_DIACRITICAL_MARKS_END = 0x036f;

function normalize(value: string): string {
  return Array.from(value.normalize('NFD'))
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return (
        code < COMBINING_DIACRITICAL_MARKS_START ||
        code > COMBINING_DIACRITICAL_MARKS_END
      );
    })
    .join('')
    .toLowerCase();
}

export function searchArticlesByQuery<T extends { article: SearchableArticle }>(
  items: T[],
  query: string,
  limit: number,
): T[] {
  const normalizedQuery = normalize(query.trim());
  if (normalizedQuery.length === 0) {
    return [];
  }

  return items
    .filter(
      (item) =>
        normalize(item.article.name).includes(normalizedQuery) ||
        normalize(item.article.openSiReference).includes(normalizedQuery),
    )
    .slice(0, limit);
}
