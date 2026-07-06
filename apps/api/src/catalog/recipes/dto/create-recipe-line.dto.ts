import { ApiProperty } from '@nestjs/swagger';
import {
  IsNumber,
  IsPositive,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class CreateRecipeLineDto {
  @ApiProperty({
    description: 'Article consommé (matière première ou packaging).',
  })
  @IsUUID()
  articleId!: string;

  @ApiProperty({
    example: 45.5,
    description:
      "Pour une matière première : pourcentage de la composition (l'ensemble des lignes matière première d'une recette doit totaliser 100%). " +
      'Pour un packaging : quantité absolue par unité produite (ex : 1 flacon, 1 bouchon).',
  })
  @IsNumber()
  @IsPositive({ message: 'La quantité par unité doit être positive.' })
  quantityPerUnit!: number;

  @ApiProperty({ example: '%' })
  @IsString()
  @MinLength(1, { message: "L'unité est obligatoire." })
  unit!: string;
}
