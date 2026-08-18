/**
 * Types partagés du module R&D / Aromathèque, tranche 1 (voir
 * apps/api/src/rnd/aroma-samples — consultation en lecture seule de
 * `RndAromaSample`). Décimaux Prisma déjà convertis en `number` côté API (voir
 * `aroma-samples.service.ts`) — aucune conversion supplémentaire nécessaire ici.
 * Dates sérialisées en chaîne ISO par l'API (JSON), comme pour les autres types
 * partagés (voir catalog.ts/production.ts). `linkedArticleId` n'est jamais exposé
 * par l'API (aucune liaison recette n'existe encore, hors périmètre) : absent
 * volontairement de ces types.
 */

import type { ImportStatus, ImportType } from './import';

/** Champs de tri autorisés par `GET /rnd/aroma-samples` (voir `AromaSamplesService.findAll`). */
export type AromaSampleSortBy = 'productName' | 'supplierNameRaw' | 'addedAt' | 'createdAt';
export type AromaSampleSortOrder = 'asc' | 'desc';

export interface AromaSampleListItem {
  id: string;
  legacyId: string;
  supplierNameRaw: string;
  productName: string;
  supplierReference: string | null;
  category: string;
  rating: number | null;
  stockGrams: number | null;
  pricePerKgEur: number | null;
  addedAt: string | null;
  comment: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PaginatedAromaSamples {
  items: AromaSampleListItem[];
  meta: PaginationMeta;
}

/** Résumé du dernier `ImportLog` ayant créé ou mis à jour l'échantillon. */
export interface AromaSampleImportLogSummary {
  id: string;
  type: ImportType;
  status: ImportStatus;
  createdAt: string;
  processedLines: number;
  errorCount: number;
}

export interface AromaSampleDetailResponse extends AromaSampleListItem {
  importLog: AromaSampleImportLogSummary | null;
}

/** Paramètres de `GET /rnd/aroma-samples` (voir `QueryAromaSamplesDto` côté API). */
export interface AromaSamplesQuery {
  page?: number;
  limit?: number;
  search?: string;
  category?: string;
  active?: boolean;
  sortBy?: AromaSampleSortBy;
  sortOrder?: AromaSampleSortOrder;
}
