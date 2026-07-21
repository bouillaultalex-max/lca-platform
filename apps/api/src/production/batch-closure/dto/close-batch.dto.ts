import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class AllocationClosureDto {
  @ApiProperty({
    description: 'Allocation concernée (doit appartenir à ce batch).',
  })
  @IsUUID()
  allocationId!: string;

  @ApiProperty({
    example: 300,
    description: 'Quantité conforme produite pour cette allocation.',
  })
  @IsInt()
  @Min(0, { message: 'La quantité produite ne peut pas être négative.' })
  producedQuantity!: number;

  @ApiProperty({
    example: 10,
    description: 'Rebuts (unités rejetées) pour cette allocation.',
  })
  @IsInt()
  @Min(0, { message: 'Les rebuts ne peuvent pas être négatifs.' })
  rejectedQuantity!: number;
}

/**
 * Saisie de fin de batch (voir MASTER_SPECIFICATION.md §4.4, docs/regles-metier.md §12,
 * ADR 0006 PRD-11). Forme acceptée selon le nombre d'allocations réelles du batch
 * (voir BatchClosureService) :
 * - **batch sans allocation** (antérieur à PRD-11, aucun backfill) : uniquement
 *   l'ancien format — `producedQuantity`/`rejectedQuantity` à la racine ;
 *   `allocations` absent ou vide ;
 * - **batch à exactement une allocation** : **les deux formes sont acceptées**
 *   (compatibilité transitoire, en attendant l'étape 14 — clôture par allocation côté
 *   frontend) — soit l'ancien format racine, soit `allocations[]` à une seule entrée ;
 * - **batch à plusieurs allocations** : uniquement le nouveau format —
 *   `allocations[]` obligatoire, une entrée par allocation réelle du batch (bijection
 *   stricte) ; champs racine refusés.
 * Fournir les champs racine ET un tableau `allocations` non vide simultanément est,
 * dans tous les cas, un payload ambigu, refusé par le service.
 */
export class CloseBatchDto {
  @ApiProperty({ example: '2026-07-06T16:00:00.000Z' })
  @IsDateString()
  endedAt!: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  formatChanged?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  formatChangeDetail?: string;

  @ApiPropertyOptional({
    example: '2028-07-06',
    description:
      'Appliquée identiquement à tous les lots générés pour ce batch.',
  })
  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @ApiPropertyOptional({
    example: 480,
    description:
      'Batch sans allocation uniquement : quantité conforme produite.',
  })
  @IsOptional()
  @IsInt()
  @Min(0, { message: 'La quantité produite ne peut pas être négative.' })
  producedQuantity?: number;

  @ApiPropertyOptional({
    example: 20,
    description: 'Batch sans allocation uniquement : rebuts.',
  })
  @IsOptional()
  @IsInt()
  @Min(0, { message: 'Les rebuts ne peuvent pas être négatifs.' })
  rejectedQuantity?: number;

  @ApiPropertyOptional({
    type: [AllocationClosureDto],
    description:
      'Batch avec allocations uniquement : une entrée par allocation réelle du batch.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AllocationClosureDto)
  allocations?: AllocationClosureDto[];
}
