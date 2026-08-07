import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ImportStatus,
  ImportType,
  Prisma,
} from '../../../generated/prisma/client';
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

/**
 * Résumé du dernier `ImportLog` ayant créé ou mis à jour l'échantillon (voir
 * RD-01D-2) — jamais `previewHash`, `errorDetails` complet ni `siteId`.
 */
export interface AromaSampleImportLogSummary {
  id: string;
  type: ImportType;
  status: ImportStatus;
  createdAt: Date;
  processedLines: number;
  errorCount: number;
}

/**
 * Fiche détail (voir RD-01D-2) : mêmes champs que `AromaSampleListItem`, enrichis du
 * dernier import d'origine. Toujours `null` pour un échantillon jamais importé (créé
 * manuellement — hors périmètre actuel, mais le champ `importLogId` reste nullable).
 */
export interface AromaSampleDetailResponse extends AromaSampleListItem {
  importLog: AromaSampleImportLogSummary | null;
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
 * Sélection de la fiche détail : reprend les mêmes champs que la liste, plus le
 * dernier `ImportLog` lié — en sélectionnant explicitement uniquement ses champs
 * utiles (`id`, `type`, `status`, `createdAt`, `processedLines`, `errorCount`),
 * jamais `previewHash`, `errorDetails`, `siteId` ni `userId` : ces champs ne sont
 * jamais lus en base pour cet écran, donc ne peuvent jamais être exposés par erreur.
 */
const SELECT_AROMA_SAMPLE_DETAIL = {
  ...SELECT_AROMA_SAMPLE_LIST_ITEM,
  importLog: {
    select: {
      id: true,
      type: true,
      status: true,
      createdAt: true,
      processedLines: true,
      errorCount: true,
    },
  },
} satisfies Prisma.RndAromaSampleSelect;

type SelectedAromaSampleDetail = Prisma.RndAromaSampleGetPayload<{
  select: typeof SELECT_AROMA_SAMPLE_DETAIL;
}>;

function toDetailResponse(
  sample: SelectedAromaSampleDetail,
): AromaSampleDetailResponse {
  return {
    id: sample.id,
    legacyId: sample.legacyId,
    supplierNameRaw: sample.supplierNameRaw,
    productName: sample.productName,
    supplierReference: sample.supplierReference,
    category: sample.category,
    rating: sample.rating ? sample.rating.toNumber() : null,
    stockGrams: sample.stockGrams ? sample.stockGrams.toNumber() : null,
    pricePerKgEur: sample.pricePerKgEur
      ? sample.pricePerKgEur.toNumber()
      : null,
    addedAt: sample.addedAt,
    comment: sample.comment,
    active: sample.active,
    createdAt: sample.createdAt,
    updatedAt: sample.updatedAt,
    importLog: sample.importLog,
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

  /**
   * Fiche détail d'un échantillon (voir RD-01D-2). Recherche systématiquement par
   * `id` + `siteId` combinés (jamais par `id` seul) : un identifiant valide d'un
   * autre site ne renvoie jamais l'échantillon, exactement comme
   * `ArticlesService.findOne()`.
   */
  async findOne(
    siteId: string,
    id: string,
  ): Promise<AromaSampleDetailResponse> {
    const sample = await this.prisma.rndAromaSample.findFirst({
      where: { id, siteId },
      select: SELECT_AROMA_SAMPLE_DETAIL,
    });
    if (!sample) {
      throw new NotFoundException(
        `Échantillon d'aromathèque ${id} introuvable.`,
      );
    }
    return toDetailResponse(sample);
  }
}
