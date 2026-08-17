import { Module } from '@nestjs/common';
import { BatchCostsService } from './batch-costs/batch-costs.service';
import { BatchCostsController } from './batch-costs/batch-costs.controller';

/**
 * Module `costing` (PRD-10, voir ADR 0007) : consultation en lecture seule du coût
 * figé d'un lot. Le calcul lui-même (`computeBatchCost`,
 * `batch-cost-calculation/batch-cost-calculation.ts`) est une fonction pure, importée
 * directement par `BatchClosureService` sans dépendre de ce module — même principe
 * que `computeFifoAllocations` (module `stock`).
 */
@Module({
  providers: [BatchCostsService],
  controllers: [BatchCostsController],
  exports: [BatchCostsService],
})
export class CostingModule {}
