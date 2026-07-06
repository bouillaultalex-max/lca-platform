import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

/**
 * Saisie de fin de batch (voir MASTER_SPECIFICATION.md §4.4 et docs/regles-metier.md §12).
 * `producedQuantity + rejectedQuantity` doit être strictement positif (validé dans le service :
 * une contrainte inter-champs n'est pas exprimable simplement avec class-validator seul).
 */
export class CloseBatchDto {
  @ApiProperty({ example: 480, description: 'Quantité conforme produite.' })
  @IsInt()
  @Min(0, { message: 'La quantité produite ne peut pas être négative.' })
  producedQuantity!: number;

  @ApiProperty({ example: 20, description: 'Rebuts (unités rejetées).' })
  @IsInt()
  @Min(0, { message: 'Les rebuts ne peuvent pas être négatifs.' })
  rejectedQuantity!: number;

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

  @ApiPropertyOptional({ example: '2028-07-06' })
  @IsOptional()
  @IsDateString()
  expiryDate?: string;
}
