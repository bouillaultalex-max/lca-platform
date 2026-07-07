import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsArray, IsOptional, ValidateNested } from 'class-validator';
import { MappingCorrectionDto } from './mapping-correction.dto';

/**
 * Corps multipart partagé par toutes les prévisualisations d'import OpenSi : le
 * fichier lui-même est reçu via `FileInterceptor` (`@UploadedFile()`), ce DTO ne
 * porte que les champs texte du formulaire. `mappingCorrections` arrive en JSON
 * sérialisé (contrainte du multipart), d'où la conversion explicite avant validation.
 */
export class PreviewImportDto {
  @ApiPropertyOptional({
    type: [MappingCorrectionDto],
    description:
      'Corrections de mapping de colonnes, sérialisées en JSON dans le formulaire.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return value;
    }
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MappingCorrectionDto)
  mappingCorrections?: MappingCorrectionDto[];
}
