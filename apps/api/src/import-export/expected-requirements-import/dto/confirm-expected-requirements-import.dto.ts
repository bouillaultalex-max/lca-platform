import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsOptional, IsUUID, ValidateNested } from 'class-validator';
import { ExpectedRequirementImportRowDto } from './expected-requirement-import-row.dto';
import { MappingCorrectionDto } from '../../dto/mapping-correction.dto';

/**
 * Confirmation : ne reçoit jamais le fichier une seconde fois, uniquement les lignes
 * déjà résolues et retenues par l'utilisateur — entièrement revalidées côté serveur
 * avant toute écriture (voir docs/regles-metier.md §7).
 */
export class ConfirmExpectedRequirementsImportDto {
  @ApiProperty()
  @IsUUID()
  importLogId!: string;

  @ApiProperty({ type: [ExpectedRequirementImportRowDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExpectedRequirementImportRowDto)
  rows!: ExpectedRequirementImportRowDto[];

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
