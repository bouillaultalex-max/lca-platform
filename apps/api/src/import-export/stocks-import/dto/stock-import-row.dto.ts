import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MinLength,
} from 'class-validator';

/**
 * Ligne déjà résolue par la prévisualisation, renvoyée par le frontend à la
 * confirmation. Porte `articleReference` (pas un id déjà résolu) : la confirmation
 * refait sa propre résolution depuis l'état actuel de la base (voir
 * docs/regles-metier.md §7) — jamais de confiance aveugle dans ce que le frontend
 * a mémorisé.
 */
export class StockImportRowDto {
  @ApiProperty({ example: 12 })
  @IsInt()
  line!: number;

  @ApiProperty({ example: 'MP-LAVANDE' })
  @IsString()
  @MinLength(1)
  articleReference!: string;

  @ApiProperty({ example: 'LOT-FOURNISSEUR-2026-001' })
  @IsString()
  @MinLength(1)
  supplierLotNumber!: string;

  @ApiProperty({ example: 200 })
  @IsNumber()
  @IsPositive()
  receivedQuantity!: number;

  @ApiProperty({ example: '2026-07-06' })
  @IsString()
  receivedAt!: string;

  @ApiPropertyOptional({ example: '2027-07-06' })
  @IsOptional()
  @IsString()
  expiryDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  comment?: string;
}
