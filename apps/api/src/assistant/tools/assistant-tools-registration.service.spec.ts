import { AssistantToolsRegistrationService } from './assistant-tools-registration.service';
import { ToolRegistryService } from './tool-registry.service';
import type { DashboardService } from '../../dashboard/dashboard.service';
import type { StockItemsService } from '../../stock/stock-items/stock-items.service';
import type { TraceabilityService } from '../../traceability/traceability.service';
import type { BatchesService } from '../../batching/batches/batches.service';
import type { BatchStopsService } from '../../production/batch-stops/batch-stops.service';
import type { ImportLogsService } from '../../import-export/import-logs/import-logs.service';

const EXPECTED_TOOL_NAMES = [
  'dashboard.getSummary',
  'stock.getArticleAvailability',
  'stock.listLowStockItems',
  'traceability.getLotByNumber',
  'production.getBatch',
  'imports.getImportHistory',
];

describe('AssistantToolsRegistrationService', () => {
  it('enregistre exactement les 6 outils métier validés en AI-03, ni plus ni moins', () => {
    const toolRegistry = new ToolRegistryService();
    const service = new AssistantToolsRegistrationService(
      toolRegistry,
      {} as DashboardService,
      {} as StockItemsService,
      {} as TraceabilityService,
      {} as BatchesService,
      {} as BatchStopsService,
      {} as ImportLogsService,
    );

    service.onModuleInit();

    const registeredNames = toolRegistry.list().map((tool) => tool.name);
    expect(registeredNames.sort()).toEqual([...EXPECTED_TOOL_NAMES].sort());
    expect(registeredNames).toHaveLength(6);
  });

  it('ne s’enregistre pas deux fois si onModuleInit est appelé une seconde fois (protection existante du registre)', () => {
    const toolRegistry = new ToolRegistryService();
    const service = new AssistantToolsRegistrationService(
      toolRegistry,
      {} as DashboardService,
      {} as StockItemsService,
      {} as TraceabilityService,
      {} as BatchesService,
      {} as BatchStopsService,
      {} as ImportLogsService,
    );

    service.onModuleInit();

    expect(() => service.onModuleInit()).toThrow(
      'Un outil nommé "dashboard.getSummary" est déjà enregistré.',
    );
  });
});
