import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

/**
 * Ajustement d'inventaire sur un StockLot précis (le lot physiquement recompté) —
 * voir docs/regles-metier.md §3 : toujours saisi comme un StockMovement, jamais
 * comme une correction silencieuse. Préserve l'invariant StockItem.availableQuantity
 * = somme des StockLot.remainingQuantity de l'article.
 */
export class AdjustStockLotDto {
  @ApiProperty({
    example: 185,
    description:
      'Quantité physiquement constatée pour ce lot (valeur absolue, pas un delta).',
  })
  @IsNumber()
  @Min(0, { message: 'La quantité constatée ne peut pas être négative.' })
  countedQuantity!: number;

  @ApiPropertyOptional({
    example: 'Écart constaté lors de l’inventaire mensuel.',
  })
  @IsOptional()
  @IsString()
  comment?: string;
}
