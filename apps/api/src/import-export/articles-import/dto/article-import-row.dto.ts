import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import { ArticleType } from '../../../../generated/prisma/client';

/**
 * Ligne déjà résolue par la prévisualisation (référence, type et coût déjà validés/typés),
 * renvoyée par le frontend à la confirmation. Toujours revalidée intégralement côté
 * serveur (voir docs/regles-metier.md §7) — ce DTO ne dispense d'aucune vérification.
 */
export class ArticleImportRowDto {
  @ApiProperty({ example: 12 })
  @IsInt()
  line!: number;

  @ApiProperty({ example: 'MP-LAVANDE' })
  @IsString()
  @MinLength(1)
  openSiReference!: string;

  @ApiProperty({ enum: ArticleType })
  @IsEnum(ArticleType)
  type!: ArticleType;

  @ApiProperty({ example: 'Parfum ambiance lavande (vrac)' })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty({ example: 'L' })
  @IsString()
  @MinLength(1)
  unitOfMeasure!: string;

  @ApiProperty({ example: 13.2 })
  @IsNumber()
  @Min(0)
  currentUnitCost!: number;
}
