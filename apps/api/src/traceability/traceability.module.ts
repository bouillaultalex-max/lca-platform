import { Module } from '@nestjs/common';
import { TraceabilityService } from './traceability.service';
import { TraceabilityController } from './traceability.controller';

@Module({
  providers: [TraceabilityService],
  controllers: [TraceabilityController]
})
export class TraceabilityModule {}
