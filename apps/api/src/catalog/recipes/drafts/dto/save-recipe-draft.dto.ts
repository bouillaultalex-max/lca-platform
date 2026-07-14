import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsISO8601,
  IsOptional,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { RecipeDraftLineDto } from './recipe-draft-line.dto';

export class SaveRecipeDraftDto {
  @ApiProperty({
    description:
      'Produit fini concerné par ce brouillon (clé du brouillon avec l’utilisateur courant).',
  })
  @IsUUID()
  finishedProductId!: string;

  @ApiPropertyOptional({
    example: 100,
    description: 'Format en cours de saisie, peut être absent/vide.',
  })
  @IsOptional()
  @IsInt()
  @Min(1, { message: 'Le format doit être positif.' })
  format?: number | null;

  @ApiProperty({ type: [RecipeDraftLineDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecipeDraftLineDto)
  lines!: RecipeDraftLineDto[];

  @ApiPropertyOptional({
    description:
      'Horodatage `updatedAt` du brouillon tel que connu par cet onglet, pour détecter un conflit (voir gestion double-onglet).',
  })
  @IsOptional()
  @IsISO8601()
  expectedUpdatedAt?: string;

  @ApiPropertyOptional({
    description:
      'Force l’enregistrement même en cas de conflit détecté (ignore expectedUpdatedAt).',
  })
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
