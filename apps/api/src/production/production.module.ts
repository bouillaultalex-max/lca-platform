import { Module } from '@nestjs/common';
import { BatchingModule } from '../batching/batching.module';
import { BatchStepsController } from './batch-steps/batch-steps.controller';
import { BatchStepsService } from './batch-steps/batch-steps.service';
import { BatchStopsController } from './batch-stops/batch-stops.controller';
import { BatchStopsService } from './batch-stops/batch-stops.service';
import { BatchClosureController } from './batch-closure/batch-closure.controller';
import { BatchClosureService } from './batch-closure/batch-closure.service';
import { LotNumberGeneratorService } from './lot-number-generator/lot-number-generator.service';

@Module({
  imports: [BatchingModule],
  controllers: [
    BatchStepsController,
    BatchStopsController,
    BatchClosureController,
  ],
  providers: [
    BatchStepsService,
    BatchStopsService,
    BatchClosureService,
    LotNumberGeneratorService,
  ],
})
export class ProductionModule {}
