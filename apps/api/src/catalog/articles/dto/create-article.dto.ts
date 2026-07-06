import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import { ArticleType } from '../../../../generated/prisma/client';

export class CreateArticleDto {
  @ApiProperty({ enum: ArticleType })
  @IsEnum(ArticleType, {
    message: 'Le type doit être MATIERE_PREMIERE, PACKAGING ou PRODUIT_FINI.',
  })
  type!: ArticleType;

  @ApiProperty({ example: 'MP-LAVANDE' })
  @IsString()
  @MinLength(1, { message: 'La référence OpenSi est obligatoire.' })
  openSiReference!: string;

  @ApiProperty({ example: 'Parfum ambiance lavande (vrac)' })
  @IsString()
  @MinLength(1, { message: 'La désignation est obligatoire.' })
  name!: string;

  @ApiProperty({ example: 'L' })
  @IsString()
  @MinLength(1, { message: "L'unité de mesure est obligatoire." })
  unitOfMeasure!: string;

  @ApiProperty({ example: 12.5 })
  @IsNumber({}, { message: 'Le coût unitaire doit être un nombre.' })
  @Min(0, { message: 'Le coût unitaire ne peut pas être négatif.' })
  currentUnitCost!: number;

  @ApiPropertyOptional({
    example: 100,
    description:
      "Conditionnement en carton, pour l'affichage uniquement (le stock reste compté en unités). " +
      'Valeur libre par article, non figée en dur — suggestion : 100 pour les flacons 10/30/50/100 ml, 36 pour les flacons 200 ml.',
  })
  @IsOptional()
  @IsInt()
  @IsPositive({ message: 'Le nombre d’unités par carton doit être positif.' })
  unitsPerCarton?: number;
}
