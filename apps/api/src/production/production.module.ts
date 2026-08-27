import { Module } from '@nestjs/common';
import { BatchingModule } from '../batching/batching.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { BatchStepsController } from './batch-steps/batch-steps.controller';
import { BatchStepsService } from './batch-steps/batch-steps.service';
import { BatchStopsController } from './batch-stops/batch-stops.controller';
import { BatchStopsService } from './batch-stops/batch-stops.service';
import { BatchClosureController } from './batch-closure/batch-closure.controller';
import { BatchClosureService } from './batch-closure/batch-closure.service';
import { LotNumberGeneratorService } from './lot-number-generator/lot-number-generator.service';
import { BatchPrintController } from './batch-print/batch-print.controller';
import { BatchPrintService } from './batch-print/batch-print.service';

@Module({
  imports: [BatchingModule, AuditLogModule],
  controllers: [
    BatchStepsController,
    BatchStopsController,
    BatchClosureController,
    BatchPrintController,
  ],
  providers: [
    BatchStepsService,
    BatchStopsService,
    BatchClosureService,
    LotNumberGeneratorService,
    BatchPrintService,
  ],
  // BatchStopsService : réutilisé par `assistant` (outil production.getBatch,
  // voir AI-03).
  exports: [BatchStopsService],
})
export class ProductionModule {}
