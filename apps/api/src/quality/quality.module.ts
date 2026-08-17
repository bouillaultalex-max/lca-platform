import { Module } from '@nestjs/common';
import { QualityChecksService } from './quality-checks/quality-checks.service';
import { QualityChecksController } from './quality-checks/quality-checks.controller';
import { AuditLogModule } from '../audit-log/audit-log.module';

/**
 * Module `quality` (QUA-01/QUA-03, voir ADR 0008) : création et consultation
 * des contrôles qualité d'un lot, recalcul du statut global associé. Le calcul
 * lui-même (`computeLotQualityStatus`,
 * `lot-quality-status/lot-quality-status-calculation.ts`) est une fonction pure,
 * appelée directement par `QualityChecksService` — même principe que
 * `computeBatchCost` (module `costing`).
 */
@Module({
  imports: [AuditLogModule],
  providers: [QualityChecksService],
  controllers: [QualityChecksController],
})
export class QualityModule {}
