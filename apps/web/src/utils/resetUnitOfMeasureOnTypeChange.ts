import type { ArticleType } from '@lca-mes/shared';

/**
 * L'unité de mesure n'est pertinente que pour une matière première (voir
 * CatalogPage, ArticlesService.resolveUnitOfMeasure côté backend). Réinitialise
 * ce champ lorsque le type choisi bascule vers un type qui ne peut pas le
 * recevoir, pour éviter qu'une valeur orpheline reste en mémoire dans le
 * formulaire (masquée mais toujours envoyée si l'utilisateur revient ensuite
 * sur MATIERE_PREMIERE sans y toucher).
 */
export function resetUnitOfMeasureOnTypeChange<T extends { unitOfMeasure: string }>(
  form: T,
  newType: ArticleType,
): T {
  if (newType === 'MATIERE_PREMIERE') return form;
  return { ...form, unitOfMeasure: '' };
}
