import { ApiPropertyOptional } from '@nestjs/swagger';
import { plainToInstance, Transform } from 'class-transformer';
import { IsArray, IsOptional, ValidateNested } from 'class-validator';
import { MappingCorrectionDto } from './mapping-correction.dto';

/**
 * Corps multipart partagé par toutes les prévisualisations d'import OpenSi : le
 * fichier lui-même est reçu via `FileInterceptor` (`@UploadedFile()`), ce DTO ne
 * porte que les champs texte du formulaire. `mappingCorrections` arrive en JSON
 * sérialisé (contrainte du multipart), d'où la conversion explicite avant validation.
 *
 * La conversion en instances `MappingCorrectionDto` doit se faire ICI, dans le
 * `@Transform` lui-même (via `plainToInstance`), et non via un `@Type()` séparé :
 * combiner les deux sur la même propriété laisse les éléments du tableau comme de
 * simples objets JSON, que `ValidationPipe({ whitelist: true })` rejette ensuite
 * ("property fieldKey should not exist") faute de les reconnaître comme instances
 * validées de la classe.
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
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed)
        ? plainToInstance(MappingCorrectionDto, parsed)
        : parsed;
    } catch {
      return value;
    }
  })
  @IsArray()
  @ValidateNested({ each: true })
  mappingCorrections?: MappingCorrectionDto[];
}
