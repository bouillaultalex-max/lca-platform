import { Injectable, OnModuleInit } from '@nestjs/common';
import { ToolRegistryService } from './tool-registry.service';
import { DashboardService } from '../../dashboard/dashboard.service';
import { StockItemsService } from '../../stock/stock-items/stock-items.service';
import { TraceabilityService } from '../../traceability/traceability.service';
import { BatchesService } from '../../batching/batches/batches.service';
import { BatchStopsService } from '../../production/batch-stops/batch-stops.service';
import { ImportLogsService } from '../../import-export/import-logs/import-logs.service';
import { createDashboardTools } from './dashboard.tools';
import { createStockTools } from './stock.tools';
import { createTraceabilityTools } from './traceability.tools';
import { createProductionTools } from './production.tools';
import { createImportsTools } from './imports.tools';

/**
 * Enregistre exactement les 6 outils métier validés en AI-03 — lecture seule,
 * aucun autre outil (voir docs/roadmap.md). Toute extension future (nouveaux
 * outils, catégories `prepare`/`execute`) fait l'objet d'un ticket dédié.
 */
@Injectable()
export class AssistantToolsRegistrationService implements OnModuleInit {
  constructor(
    private readonly toolRegistry: ToolRegistryService,
    private readonly dashboardService: DashboardService,
    private readonly stockItemsService: StockItemsService,
    private readonly traceabilityService: TraceabilityService,
    private readonly batchesService: BatchesService,
    private readonly batchStopsService: BatchStopsService,
    private readonly importLogsService: ImportLogsService,
  ) {}

  onModuleInit(): void {
    const tools = [
      ...createDashboardTools(this.dashboardService),
      ...createStockTools(this.stockItemsService),
      ...createTraceabilityTools(this.traceabilityService),
      ...createProductionTools(this.batchesService, this.batchStopsService),
      ...createImportsTools(this.importLogsService),
    ];

    for (const tool of tools) {
      this.toolRegistry.register(tool);
    }
  }
}
