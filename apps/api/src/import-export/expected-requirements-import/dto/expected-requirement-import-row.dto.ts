import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

/**
 * Ligne déjà résolue par la prévisualisation, renvoyée par le frontend à la
 * confirmation. Porte `articleReference` (pas un id déjà résolu) : la confirmation
 * refait sa propre résolution depuis l'état actuel de la base (voir
 * docs/regles-metier.md §7).
 */
export class ExpectedRequirementImportRowDto {
  @ApiProperty({ example: 12 })
  @IsInt()
  line!: number;

  @ApiProperty({ example: 'PF-LAVANDE-100ML' })
  @IsString()
  @MinLength(1)
  articleReference!: string;

  @ApiProperty({ example: 500 })
  @IsNumber()
  @Min(0)
  importedRequirement!: number;

  @ApiPropertyOptional({ example: 120 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  reservedQuantity?: number;

  @ApiPropertyOptional({ example: '2026-07-06' })
  @IsOptional()
  @IsString()
  importedAt?: string;
}
