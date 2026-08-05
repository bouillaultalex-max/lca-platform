import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

/** Champs autorisés pour le tri (voir `AromaSamplesService.findAll`). */
export enum AromaSampleSortBy {
  PRODUCT_NAME = 'productName',
  SUPPLIER_NAME_RAW = 'supplierNameRaw',
  ADDED_AT = 'addedAt',
  CREATED_AT = 'createdAt',
}

export enum AromaSampleSortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

export const DEFAULT_AROMA_SAMPLES_PAGE = 1;
export const DEFAULT_AROMA_SAMPLES_LIMIT = 20;
export const MAX_AROMA_SAMPLES_LIMIT = 100;

/**
 * Paramètres de consultation paginée des échantillons d'aromathèque (voir RD-01D-1).
 * Ne porte jamais `siteId` : l'isolation par site vient uniquement de
 * `@CurrentUser()` côté contrôleur, jamais d'un champ de requête (voir
 * `aroma-samples.controller.ts`).
 */
export class QueryAromaSamplesDto {
  @ApiPropertyOptional({
    default: DEFAULT_AROMA_SAMPLES_PAGE,
    minimum: 1,
    description: 'Numéro de page (1-indexé).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = DEFAULT_AROMA_SAMPLES_PAGE;

  @ApiPropertyOptional({
    default: DEFAULT_AROMA_SAMPLES_LIMIT,
    minimum: 1,
    maximum: MAX_AROMA_SAMPLES_LIMIT,
    description: 'Nombre de lignes par page.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_AROMA_SAMPLES_LIMIT)
  limit: number = DEFAULT_AROMA_SAMPLES_LIMIT;

  @ApiPropertyOptional({
    description:
      'Recherche globale (insensible à la casse) sur le produit, le fournisseur, la référence fournisseur et l’identifiant historique.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  search?: string;

  @ApiPropertyOptional({ description: 'Filtre exact sur la catégorie.' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  category?: string;

  @ApiPropertyOptional({
    description: 'Filtre exact sur le statut actif/inactif.',
  })
  @IsOptional()
  // Les paramètres de requête HTTP arrivent toujours en chaîne de caractères :
  // `@Type(() => Boolean)` convertirait "false" en `true` (toute chaîne non vide
  // est "truthy" en JavaScript) — conversion explicite et fermée ici, jamais de
  // coercition générique pour un booléen.
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ enum: AromaSampleSortBy })
  @IsOptional()
  @IsEnum(AromaSampleSortBy)
  sortBy?: AromaSampleSortBy;

  @ApiPropertyOptional({ enum: AromaSampleSortOrder })
  @IsOptional()
  @IsEnum(AromaSampleSortOrder)
  sortOrder?: AromaSampleSortOrder;
}
