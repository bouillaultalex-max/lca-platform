import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsPositive, IsUUID } from 'class-validator';

export class AddBatchProductAllocationDto {
  @ApiPropertyOptional({
    description:
      'Marché déjà décliné pour le produit de référence du batch — précisez soit un marché, soit un produit, jamais les deux.',
  })
  @IsOptional()
  @IsUUID()
  marketId?: string;

  @ApiPropertyOptional({
    description:
      'Produit fini sans famille commerciale — précisez soit un marché, soit un produit, jamais les deux. La recette est toujours résolue automatiquement, jamais choisie ici.',
  })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiProperty({
    example: 200,
    description: 'Quantité planifiée pour cette allocation.',
  })
  @IsInt()
  @IsPositive({ message: 'La quantité planifiée doit être positive.' })
  plannedQuantity!: number;
}
