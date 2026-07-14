import { Module } from '@nestjs/common';
import { BatchesController } from './batches/batches.controller';
import { BatchesService } from './batches/batches.service';
import { BatchPreparationService } from './batch-preparation/batch-preparation.service';
import { BatchFeasibilityService } from './batch-feasibility/batch-feasibility.service';

@Module({
  controllers: [BatchesController],
  providers: [BatchesService, BatchPreparationService, BatchFeasibilityService],
  // BatchPreparationService est réutilisé par le module `production` à la clôture du
  // batch (recalcul sur la quantité totale réelle, voir docs/regles-metier.md §12).
  // BatchFeasibilityService est réutilisé par `BatchStepsService` (production) pour
  // bloquer le lancement d'un batch si les stocks sont insuffisants.
  exports: [BatchPreparationService, BatchFeasibilityService],
})
export class BatchingModule {}
