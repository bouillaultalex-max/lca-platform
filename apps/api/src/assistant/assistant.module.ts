import { Module } from '@nestjs/common';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { ToolCallingOrchestrator } from './tool-calling-orchestrator.service';
import { ToolRegistryService } from './tools/tool-registry.service';
import { ToolExecutorService } from './tools/tool-executor.service';
import { AssistantToolsRegistrationService } from './tools/assistant-tools-registration.service';
import { AI_PROVIDER } from './providers/ai-provider.interface';
import { EchoAiProvider } from './providers/echo-ai-provider.service';
import { DashboardModule } from '../dashboard/dashboard.module';
import { StockModule } from '../stock/stock.module';
import { TraceabilityModule } from '../traceability/traceability.module';
import { BatchingModule } from '../batching/batching.module';
import { ProductionModule } from '../production/production.module';
import { ImportExportModule } from '../import-export/import-export.module';

/**
 * Module Assistant. `EchoAiProvider` est un remplaçant temporaire de `AiProvider`
 * (voir providers/echo-ai-provider.service.ts) : remplacer un fournisseur réel
 * plus tard ne demande de changer que la ligne `useClass` ci-dessous, jamais
 * AssistantService ni AssistantController. Les modules métier importés ci-dessous
 * ne le sont que pour exposer, en lecture seule, les 6 outils validés en AI-03
 * (voir tools/assistant-tools-registration.service.ts) — aucune logique métier
 * nouvelle n'est ajoutée dans ce module. `ToolCallingOrchestrator` (AI-04)
 * concentre toute la logique de raisonnement (tours, exécution des outils,
 * limites) : `AssistantService` ne fait que gérer les conversations, persister
 * les messages et traduire en SSE (voir tool-calling-orchestrator.service.ts).
 */
@Module({
  imports: [
    DashboardModule,
    StockModule,
    TraceabilityModule,
    BatchingModule,
    ProductionModule,
    ImportExportModule,
  ],
  controllers: [AssistantController],
  providers: [
    AssistantService,
    ToolCallingOrchestrator,
    ToolRegistryService,
    ToolExecutorService,
    AssistantToolsRegistrationService,
    { provide: AI_PROVIDER, useClass: EchoAiProvider },
  ],
})
export class AssistantModule {}
