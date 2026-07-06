import { Module } from '@nestjs/common';
import { BatchesController } from './batches/batches.controller';
import { BatchesService } from './batches/batches.service';
import { BatchPreparationService } from './batch-preparation/batch-preparation.service';

@Module({
  controllers: [BatchesController],
  providers: [BatchesService, BatchPreparationService],
  // BatchPreparationService est réutilisé par le module `production` à la clôture
  // du batch (recalcul sur la quantité totale réelle, voir docs/regles-metier.md §12).
  exports: [BatchPreparationService],
})
export class BatchingModule {}
