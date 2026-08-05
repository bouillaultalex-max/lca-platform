import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsOptional, IsUUID, ValidateNested } from 'class-validator';
import { AromaSampleImportRowDto } from './aroma-sample-import-row.dto';
import { MappingCorrectionDto } from '../../../import-export/dto/mapping-correction.dto';

/**
 * Confirmation : ne reçoit jamais le fichier une seconde fois, uniquement les lignes
 * déjà résolues et retenues par l'utilisateur — entièrement revalidées, ré-empreintées
 * (`previewHash`) et reclassifiées côté serveur avant toute écriture (voir
 * docs/regles-metier.md §7 et `aroma-samples-import.service.ts`).
 */
export class ConfirmAromaSamplesImportDto {
  @ApiProperty()
  @IsUUID()
  importLogId!: string;

  @ApiProperty({ type: [AromaSampleImportRowDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AromaSampleImportRowDto)
  rows!: AromaSampleImportRowDto[];

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
