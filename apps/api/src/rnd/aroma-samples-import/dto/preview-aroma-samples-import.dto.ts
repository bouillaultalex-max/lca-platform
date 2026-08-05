import { ApiPropertyOptional } from '@nestjs/swagger';
import { plainToInstance, Transform } from 'class-transformer';
import { IsArray, IsOptional, ValidateNested } from 'class-validator';
import { MappingCorrectionDto } from '../../../import-export/dto/mapping-correction.dto';

/**
 * Corps multipart de la prévisualisation d'import Aromathèque : le fichier lui-même
 * est reçu via `FileInterceptor` (`@UploadedFile()`), ce DTO ne porte que les champs
 * texte du formulaire. `mappingCorrections` arrive en JSON sérialisé (contrainte du
 * multipart), d'où la conversion explicite avant validation — même structure que
 * `PreviewImportDto` (import-export), dupliquée ici à dessein pour que le domaine R&D
 * ne dépende pas du DTO d'un connecteur OpenSi (voir `aroma-sample.mapping-config.ts`,
 * déjà une configuration distincte).
 *
 * La conversion en instances `MappingCorrectionDto` doit se faire ICI, dans le
 * `@Transform` lui-même (via `plainToInstance`), et non via un `@Type()` séparé :
 * combiner les deux sur la même propriété laisse les éléments du tableau comme de
 * simples objets JSON, que `ValidationPipe({ whitelist: true })` rejette ensuite
 * ("property fieldKey should not exist") faute de les reconnaître comme instances
 * validées de la classe.
 */
export class PreviewAromaSamplesImportDto {
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
