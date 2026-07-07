import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

/**
 * Correction manuelle d'une correspondance colonne → champ, transmise telle quelle
 * au moteur générique (`MappingCorrection`, voir ADR 0003). Partagée par tous les
 * imports OpenSi (articles, stocks, besoins attendus, inventaire).
 */
export class MappingCorrectionDto {
  @ApiProperty({ example: 'openSiReference' })
  @IsString()
  @MinLength(1)
  fieldKey!: string;

  @ApiProperty({ example: 'Code article' })
  @IsString()
  @MinLength(1)
  columnName!: string;
}
