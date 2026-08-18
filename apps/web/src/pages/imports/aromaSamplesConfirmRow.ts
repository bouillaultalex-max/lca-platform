import type { AromaSampleImportRow, AromaSampleImportRowWithStatus } from '@lca-mes/shared';

function nullToUndefined<T>(value: T | null): T | undefined {
  return value === null ? undefined : value;
}

/**
 * Ramène une ligne de prévisualisation (champs nullable, porte aussi
 * `status`/`sampleId`/`changes`) au strict format attendu par
 * `/rnd/aroma-samples/import/confirm` (champs optionnels, jamais `null`). Le
 * backend revalide tout côté serveur et rejette (400, `forbidNonWhitelisted`)
 * toute propriété non prévue par le DTO.
 */
export function toAromaSampleConfirmRow(row: AromaSampleImportRowWithStatus): AromaSampleImportRow {
  return {
    line: row.line,
    legacyId: row.legacyId,
    supplierNameRaw: row.supplierNameRaw,
    productName: row.productName,
    supplierReference: nullToUndefined(row.supplierReference),
    category: row.category,
    rating: nullToUndefined(row.rating),
    stockGrams: nullToUndefined(row.stockGrams),
    pricePerKgEur: nullToUndefined(row.pricePerKgEur),
    addedAt: nullToUndefined(row.addedAt),
    comment: nullToUndefined(row.comment),
  };
}
