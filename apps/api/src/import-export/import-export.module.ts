import { Module } from '@nestjs/common';
import { ImportLogsController } from './import-logs/import-logs.controller';
import { ImportLogsService } from './import-logs/import-logs.service';
import { ImportParserService } from './import-parser/import-parser.service';
import { ColumnMappingModule } from '../common/column-mapping/column-mapping.module';

@Module({
  imports: [ColumnMappingModule],
  controllers: [ImportLogsController],
  providers: [ImportLogsService, ImportParserService],
  // Réutilisés par les futurs services d'import par type (articles, stocks,
  // besoins attendus, inventaire — Jalon 2 E5+).
  exports: [ImportLogsService, ImportParserService, ColumnMappingModule],
})
export class ImportExportModule {}
