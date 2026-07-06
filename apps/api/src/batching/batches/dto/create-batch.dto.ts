import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsPositive, IsUUID } from 'class-validator';

export class CreateBatchDto {
  @ApiProperty({ description: 'Recette à utiliser (doit être ACTIVE).' })
  @IsUUID()
  recipeId!: string;

  @ApiProperty({
    description:
      'Machine de conditionnement (doit supporter le format de la recette).',
  })
  @IsUUID()
  machineId!: string;

  @ApiProperty({
    example: 500,
    description:
      'Quantité à produire (nombre d’unités du format de la recette).',
  })
  @IsInt()
  @IsPositive({ message: 'La quantité à produire doit être positive.' })
  plannedQuantity!: number;
}
