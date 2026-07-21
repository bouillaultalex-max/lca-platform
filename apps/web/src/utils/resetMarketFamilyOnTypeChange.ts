import type { ArticleType } from '@lca-mes/shared';

/**
 * Famille commerciale et marché ne sont pertinents que pour un PRODUIT_FINI (voir
 * CatalogPage, ADR 0006 PRD-11). Réinitialise ces deux champs lorsque le type
 * choisi bascule vers un type qui ne peut pas les recevoir, pour éviter qu'une
 * association orpheline reste en mémoire dans le formulaire (masquée mais toujours
 * envoyée si l'utilisateur revient ensuite sur PRODUIT_FINI sans y toucher).
 */
export function resetMarketFamilyOnTypeChange<T extends { productFamilyId: string; marketId: string }>(
  form: T,
  newType: ArticleType,
): T {
  if (newType === 'PRODUIT_FINI') return form;
  return { ...form, productFamilyId: '', marketId: '' };
}
