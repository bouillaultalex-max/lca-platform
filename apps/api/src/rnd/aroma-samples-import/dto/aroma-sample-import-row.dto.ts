import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

/**
 * Ligne déjà résolue par la prévisualisation (identifiant historique, fournisseur et
 * produit déjà validés, catégorie déjà normalisée), renvoyée par le frontend à la
 * confirmation. Toujours revalidée et reclassifiée intégralement côté serveur (voir
 * docs/regles-metier.md §7) — ce DTO ne dispense d'aucune vérification.
 *
 * Ne porte jamais `siteId`, `active`, `linkedArticleId` ni `importLogId` : ces champs
 * restent hors de portée d'un import (décision R&D confirmée, voir RD-01).
 */
export class AromaSampleImportRowDto {
  @ApiProperty({ example: 12 })
  @IsInt()
  line!: number;

  @ApiProperty({ example: 'EF-0378-00042' })
  @IsString()
  @MinLength(1)
  legacyId!: string;

  @ApiProperty({ example: 'Fournisseur Aromatique SA' })
  @IsString()
  @MinLength(1)
  supplierNameRaw!: string;

  @ApiProperty({ example: 'Vanille Bourbon' })
  @IsString()
  @MinLength(1)
  productName!: string;

  @ApiPropertyOptional({ example: 'REF-2026-001' })
  @IsOptional()
  @IsString()
  supplierReference?: string;

  @ApiProperty({ example: 'Autre' })
  @IsString()
  @MinLength(1)
  category!: string;

  @ApiPropertyOptional({ example: 4 })
  @IsOptional()
  @IsNumber()
  rating?: number;

  @ApiPropertyOptional({ example: 250 })
  @IsOptional()
  @IsNumber()
  stockGrams?: number;

  @ApiPropertyOptional({ example: 89.5 })
  @IsOptional()
  @IsNumber()
  pricePerKgEur?: number;

  @ApiPropertyOptional({ example: '2026-07-06' })
  @IsOptional()
  @IsString()
  addedAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  comment?: string;
}
