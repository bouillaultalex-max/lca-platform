import type { ArticleImportRow, ArticleImportRowWithDiff } from '@lca-mes/shared';

/**
 * Ramène une ligne de prévisualisation (création ou mise à jour, cette dernière
 * portant `articleId`/`changes` en plus) au strict format attendu par
 * `/import-export/articles/confirm`. Le backend revalide tout côté serveur et
 * rejette (400, `forbidNonWhitelisted`) toute propriété non prévue par le DTO.
 */
export function toArticlesConfirmRow(
  row: ArticleImportRow | ArticleImportRowWithDiff,
): ArticleImportRow {
  const { line, openSiReference, type, name, unitOfMeasure, currentUnitCost } = row;
  return { line, openSiReference, type, name, unitOfMeasure, currentUnitCost };
}
