import type { Article } from '@lca-mes/shared';

/**
 * Détermine si le formulaire d'ajout d'allocation doit proposer un choix de marché
 * (produit de référence rattaché à une famille commerciale) ou un choix de produit
 * fini directement (voir ADR 0006, PRD-11 — l'utilisateur ne choisit jamais les
 * deux à la fois, résolution automatique par le catalogue).
 */
export function resolveAllocationMode(
  referenceProduct: Pick<Article, 'productFamilyId'> | null,
): 'market' | 'product' {
  return referenceProduct?.productFamilyId ? 'market' : 'product';
}

/**
 * Déclinaisons de marché éligibles pour ajouter une allocation à un batch dont le
 * produit de référence appartient à une famille commerciale (voir
 * BatchProductAllocationsService.resolveProductByMarket) : produits finis actifs de
 * la même famille commerciale, ayant un marché renseigné, dont le marché n'est pas
 * déjà alloué dans ce batch. Retourne les articles eux-mêmes (pas seulement les
 * identifiants de marché) pour permettre l'affichage de leur désignation.
 */
export function getEligibleMarketDeclinations(
  articles: Article[],
  productFamilyId: string,
  allocatedMarketIds: ReadonlyArray<string>,
): Article[] {
  const excluded = new Set(allocatedMarketIds);
  return articles.filter(
    (article) =>
      article.active &&
      article.type === 'PRODUIT_FINI' &&
      article.productFamilyId === productFamilyId &&
      article.marketId !== null &&
      !excluded.has(article.marketId),
  );
}

/**
 * Produits finis éligibles pour ajouter une allocation à un batch dont le produit de
 * référence n'appartient à aucune famille commerciale (voir
 * BatchProductAllocationsService.resolveProductDirectly) : produits finis actifs,
 * sans famille commerciale, non déjà alloués dans ce batch. La compatibilité de
 * recette (format, composition matière première) n'est volontairement pas
 * revérifiée ici — elle reste une vérification exclusivement serveur (voir
 * areMaterialFormulasCompatible), pour ne jamais dupliquer ni faire diverger cette
 * règle métier.
 */
export function getEligibleStandaloneProducts(
  articles: Article[],
  allocatedProductIds: ReadonlyArray<string>,
): Article[] {
  const excluded = new Set(allocatedProductIds);
  return articles.filter(
    (article) =>
      article.active &&
      article.type === 'PRODUIT_FINI' &&
      article.productFamilyId === null &&
      !excluded.has(article.id),
  );
}
