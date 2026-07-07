import { Module } from '@nestjs/common';
import { ImportLogsController } from './import-logs/import-logs.controller';
import { ImportLogsService } from './import-logs/import-logs.service';
import { ImportParserService } from './import-parser/import-parser.service';
import { ColumnMappingModule } from '../common/column-mapping/column-mapping.module';
import { ArticlesImportController } from './articles-import/articles-import.controller';
import { ArticlesImportService } from './articles-import/articles-import.service';
import { StocksImportController } from './stocks-import/stocks-import.controller';
import { StocksImportService } from './stocks-import/stocks-import.service';
import { ExpectedRequirementsImportController } from './expected-requirements-import/expected-requirements-import.controller';
import { ExpectedRequirementsImportService } from './expected-requirements-import/expected-requirements-import.service';
import { InventoryImportController } from './inventory-import/inventory-import.controller';
import { InventoryImportService } from './inventory-import/inventory-import.service';
import { StockModule } from '../stock/stock.module';

@Module({
  imports: [ColumnMappingModule, StockModule],
  controllers: [
    ImportLogsController,
    ArticlesImportController,
    StocksImportController,
    ExpectedRequirementsImportController,
    InventoryImportController,
  ],
  providers: [
    ImportLogsService,
    ImportParserService,
    ArticlesImportService,
    StocksImportService,
    ExpectedRequirementsImportService,
    InventoryImportService,
  ],
  exports: [ImportLogsService, ImportParserService, ColumnMappingModule],
})
export class ImportExportModule {}
