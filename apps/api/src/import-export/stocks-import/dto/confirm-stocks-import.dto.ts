import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsOptional, IsUUID, ValidateNested } from 'class-validator';
import { StockImportRowDto } from './stock-import-row.dto';
import { MappingCorrectionDto } from '../../dto/mapping-correction.dto';

/**
 * Confirmation : ne reçoit jamais le fichier une seconde fois, uniquement les lignes
 * déjà résolues et retenues par l'utilisateur — entièrement revalidées côté serveur
 * avant toute écriture (voir docs/regles-metier.md §7).
 */
export class ConfirmStocksImportDto {
  @ApiProperty()
  @IsUUID()
  importLogId!: string;

  @ApiProperty({ type: [StockImportRowDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StockImportRowDto)
  rows!: StockImportRowDto[];

  @ApiPropertyOptional({
    type: [MappingCorrectionDto],
    description:
      'Mêmes corrections de mapping que celles utilisées à la prévisualisation, pour être mémorisées (voir ADR 0003 §5).',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MappingCorrectionDto)
  mappingCorrections?: MappingCorrectionDto[];
}
