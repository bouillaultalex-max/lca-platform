import { Module } from '@nestjs/common';
import { BatchesController } from './batches/batches.controller';
import { BatchesService } from './batches/batches.service';
import { BatchPreparationService } from './batch-preparation/batch-preparation.service';
import { BatchFeasibilityService } from './batch-feasibility/batch-feasibility.service';
import { BatchProductAllocationsController } from './batch-product-allocations/batch-product-allocations.controller';
import { BatchProductAllocationsService } from './batch-product-allocations/batch-product-allocations.service';

@Module({
  controllers: [BatchesController, BatchProductAllocationsController],
  providers: [
    BatchesService,
    BatchPreparationService,
    BatchFeasibilityService,
    BatchProductAllocationsService,
  ],
  // BatchPreparationService est réutilisé par le module `production` à la clôture du
  // batch (recalcul sur la quantité totale réelle, voir docs/regles-metier.md §12).
  // BatchFeasibilityService est réutilisé par `BatchStepsService` (production) pour
  // bloquer le lancement d'un batch si les stocks sont insuffisants.
  // BatchProductAllocationsService sera réutilisé par BatchesService.create (étape 6,
  // PRD-11) et par BatchClosureService (étape 10, module `production`).
  exports: [
    BatchPreparationService,
    BatchFeasibilityService,
    BatchProductAllocationsService,
  ],
})
export class BatchingModule {}
