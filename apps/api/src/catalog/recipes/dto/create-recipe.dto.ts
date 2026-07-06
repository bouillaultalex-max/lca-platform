import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsInt,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { CreateRecipeLineDto } from './create-recipe-line.dto';

/**
 * Crée toujours une nouvelle recette : s'il existe déjà une version ACTIVE pour ce
 * produit fini + format, elle est archivée automatiquement et remplacée par une
 * nouvelle version (voir docs/regles-metier.md §2). Il n'y a volontairement aucun
 * endpoint de modification des lignes d'une recette existante : une recette (active
 * ou archivée) n'est jamais modifiée en place.
 */
export class CreateRecipeDto {
  @ApiProperty({
    description: 'Article de type PRODUIT_FINI concerné par la recette.',
  })
  @IsUUID()
  finishedProductId!: string;

  @ApiProperty({ example: 100, description: 'Format de conditionnement (ml).' })
  @IsInt()
  @Min(1, { message: 'Le format doit être positif.' })
  format!: number;

  @ApiProperty({ type: [CreateRecipeLineDto] })
  @ArrayNotEmpty({ message: 'Une recette doit avoir au moins une ligne.' })
  @ValidateNested({ each: true })
  @Type(() => CreateRecipeLineDto)
  lines!: CreateRecipeLineDto[];
}
