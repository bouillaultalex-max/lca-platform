import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import {
  AromaSampleSortBy,
  AromaSampleSortOrder,
  DEFAULT_AROMA_SAMPLES_LIMIT,
  DEFAULT_AROMA_SAMPLES_PAGE,
  QueryAromaSamplesDto,
} from './dto/query-aroma-samples.dto';

/**
 * Ligne exposée par l'API de consultation : sous-ensemble volontairement restreint de
 * `RndAromaSample` (voir RD-01D-1) — ni `importLogId` (détail d'audit d'import, sans
 * intérêt pour la consultation), ni `linkedArticleId`/`siteId` (aucune liaison recette
 * n'existe encore, hors périmètre de ce ticket). Les décimaux Prisma sont convertis en
 * `number` simple, jamais exposés en `Prisma.Decimal`.
 */
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
  addedAt: Date | null;
  comment: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
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

const SELECT_AROMA_SAMPLE_LIST_ITEM = {
  id: true,
  legacyId: true,
  supplierNameRaw: true,
  productName: true,
  supplierReference: true,
  category: true,
  rating: true,
  stockGrams: true,
  pricePerKgEur: true,
  addedAt: true,
  comment: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.RndAromaSampleSelect;

type SelectedAromaSample = Prisma.RndAromaSampleGetPayload<{
  select: typeof SELECT_AROMA_SAMPLE_LIST_ITEM;
}>;

function toListItem(sample: SelectedAromaSample): AromaSampleListItem {
  return {
    ...sample,
    rating: sample.rating ? sample.rating.toNumber() : null,
    stockGrams: sample.stockGrams ? sample.stockGrams.toNumber() : null,
    pricePerKgEur: sample.pricePerKgEur
      ? sample.pricePerKgEur.toNumber()
      : null,
  };
}

/**
 * Dictionnaire fermé (jamais d'accès dynamique par clé calculée, voir
 * `ArticlesImportService.resolveArticleType` pour la même convention) : chaque champ
 * de tri autorisé est explicitement mappé, aucun risque d'injecter une clé Prisma
 * arbitraire via `sortBy`.
 */
function buildOrderBy(
  sortBy: AromaSampleSortBy | undefined,
  sortOrder: AromaSampleSortOrder | undefined,
): Prisma.RndAromaSampleOrderByWithRelationInput {
  const direction: 'asc' | 'desc' =
    sortOrder === AromaSampleSortOrder.ASC ? 'asc' : 'desc';

  switch (sortBy) {
    case AromaSampleSortBy.PRODUCT_NAME:
      return { productName: direction };
    case AromaSampleSortBy.SUPPLIER_NAME_RAW:
      return { supplierNameRaw: direction };
    case AromaSampleSortBy.ADDED_AT:
      return { addedAt: direction };
    case AromaSampleSortBy.CREATED_AT:
    default:
      return { createdAt: direction };
  }
}

/**
 * Consultation en lecture seule des échantillons d'aromathèque (voir RD-01D-1) :
 * aucune écriture, aucune logique métier d'import — cette classe ne fait que projeter
 * `RndAromaSample` en pages filtrées/triées. L'import (RD-01C) reste seul responsable
 * de toute écriture sur ce modèle.
 */
@Injectable()
export class AromaSamplesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    siteId: string,
    query: QueryAromaSamplesDto,
  ): Promise<PaginatedAromaSamples> {
    const page =
      query.page && query.page > 0 ? query.page : DEFAULT_AROMA_SAMPLES_PAGE;
    const limit =
      query.limit && query.limit > 0
        ? query.limit
        : DEFAULT_AROMA_SAMPLES_LIMIT;

    // `siteId` vient uniquement du paramètre de méthode (renseigné par le contrôleur
    // depuis `@CurrentUser()`) : jamais du DTO de requête, qui ne porte pas ce champ.
    const where: Prisma.RndAromaSampleWhereInput = { siteId };

    if (query.category) {
      where.category = query.category;
    }
    if (query.active !== undefined) {
      where.active = query.active;
    }
    if (query.search) {
      const search = query.search;
      where.OR = [
        { productName: { contains: search, mode: 'insensitive' } },
        { supplierNameRaw: { contains: search, mode: 'insensitive' } },
        { supplierReference: { contains: search, mode: 'insensitive' } },
        { legacyId: { contains: search, mode: 'insensitive' } },
      ];
    }

    const orderBy = buildOrderBy(query.sortBy, query.sortOrder);

    const [samples, total] = await Promise.all([
      this.prisma.rndAromaSample.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        select: SELECT_AROMA_SAMPLE_LIST_ITEM,
      }),
      this.prisma.rndAromaSample.count({ where }),
    ]);

    return {
      items: samples.map(toListItem),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
