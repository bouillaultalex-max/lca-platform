import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/**
 * Ligne de brouillon : volontairement permissive, sans aucune des contraintes de
 * `CreateRecipeLineDto` (UUID valide, quantité positive, unité non vide). Un brouillon
 * doit pouvoir être enregistré à tout moment de la saisie, y compris incomplet.
 */
export class RecipeDraftLineDto {
  @ApiPropertyOptional({
    description: 'Article sélectionné (peut être vide en cours de saisie).',
  })
  @IsOptional()
  @IsString()
  articleId?: string;

  @ApiPropertyOptional({
    description:
      'Quantité saisie telle quelle (texte brut, non encore validée).',
  })
  @IsOptional()
  @IsString()
  quantityPerUnit?: string;

  @ApiPropertyOptional({ description: 'Unité saisie telle quelle.' })
  @IsOptional()
  @IsString()
  unit?: string;
}
