import { Module } from '@nestjs/common';
import { ColumnMappingService } from './column-mapping.service';

/**
 * Moteur générique de mapping de colonnes (voir ADR 0003), importable par n'importe
 * quel module connecteur (aujourd'hui `import-export`, demain d'autres sources).
 */
@Module({
  providers: [ColumnMappingService],
  exports: [ColumnMappingService],
})
export class ColumnMappingModule {}
