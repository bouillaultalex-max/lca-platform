import { Module } from '@nestjs/common';
import { ImportExportModule } from '../import-export/import-export.module';
import { ImportFileValidationService } from '../import-export/import-file-validation.service';
import { AromaSamplesImportController } from './aroma-samples-import/aroma-samples-import.controller';
import { AromaSamplesImportService } from './aroma-samples-import/aroma-samples-import.service';

/**
 * Module R&D (voir RD-01) : échantillons d'aromathèque, distincts du catalogue de
 * production (`Article`) — voir docs/architecture.md "Évolutions futures". Importe
 * `ImportExportModule` uniquement pour réutiliser ses services génériques d'import
 * déjà exportés (`ImportLogsService`, `ImportParserService`, `ColumnMappingService`
 * via `ColumnMappingModule`) : aucune logique métier R&D n'y est déplacée, et
 * l'import d'un module n'expose jamais les contrôleurs qu'il déclare lui-même.
 *
 * `ImportFileValidationService` (validation du contenu réel du fichier, voir SEC-07)
 * n'est pas exporté par `ImportExportModule` : il est donc fourni ici comme second
 * provider indépendant plutôt que de modifier ce module hors périmètre (RD-01C-4) —
 * ce service est sans état, sans dépendance de constructeur, l'instancier deux fois
 * n'a aucun effet de bord.
 */
@Module({
  imports: [ImportExportModule],
  controllers: [AromaSamplesImportController],
  providers: [AromaSamplesImportService, ImportFileValidationService],
})
export class RndModule {}
