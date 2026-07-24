import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { ToolCallingOrchestrator } from './tool-calling-orchestrator.service';
import { ContextEngine } from './context-engine.service';
import { ASSISTANT_CLOCK, SystemClock } from './context/clock';
import { ToolRegistryService } from './tools/tool-registry.service';
import { ToolExecutorService } from './tools/tool-executor.service';
import { AssistantToolsRegistrationService } from './tools/assistant-tools-registration.service';
import {
  AI_PROVIDER,
  type AiProvider,
} from './providers/ai-provider.interface';
import { EchoAiProvider } from './providers/echo-ai-provider.service';
import { OpenAiProvider } from './providers/openai-ai-provider.service';
import { DashboardModule } from '../dashboard/dashboard.module';
import { StockModule } from '../stock/stock.module';
import { TraceabilityModule } from '../traceability/traceability.module';
import { BatchingModule } from '../batching/batching.module';
import { ProductionModule } from '../production/production.module';
import { ImportExportModule } from '../import-export/import-export.module';

/**
 * Module Assistant. `AI_PROVIDER` (AI-06, voir env.validation.ts) sélectionne
 * l'implémentation de `AiProvider` via une factory unique ci-dessous — seul
 * point de décision de toute l'application, jamais un `if/else` dispersé
 * ailleurs, jamais de lecture directe de `process.env` (uniquement
 * `ConfigService`, déjà validé au démarrage). Les autres consommateurs
 * (AssistantService, ToolCallingOrchestrator) continuent d'injecter
 * uniquement le jeton abstrait `AI_PROVIDER`, sans jamais connaître
 * `EchoAiProvider`/`OpenAiProvider` ni le SDK `openai`.
 *
 * Les modules métier importés ci-dessous ne le sont que pour exposer, en
 * lecture seule, les 6 outils validés en AI-03 (voir
 * tools/assistant-tools-registration.service.ts) — aucune logique métier
 * nouvelle n'est ajoutée dans ce module. `ToolCallingOrchestrator` (AI-04)
 * concentre toute la logique de raisonnement (tours, exécution des outils,
 * limites) : `AssistantService` ne fait que gérer les conversations, persister
 * les messages et traduire en SSE (voir tool-calling-orchestrator.service.ts).
 * `ContextEngine` (AI-05) prépare exactement ce qui est envoyé au fournisseur
 * (prompt système, contexte statique, sélection/résumé de l'historique) —
 * aucune dépendance base de données, uniquement une horloge injectable
 * (`ASSISTANT_CLOCK`, voir context/clock.ts) pour rester déterministe en test.
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
    ContextEngine,
    { provide: ASSISTANT_CLOCK, useClass: SystemClock },
    ToolRegistryService,
    ToolExecutorService,
    AssistantToolsRegistrationService,
    {
      provide: AI_PROVIDER,
      useFactory: (configService: ConfigService): AiProvider => {
        if (configService.get<string>('AI_PROVIDER') === 'openai') {
          const client = new OpenAI({
            apiKey: configService.get<string>('AI_API_KEY'),
            baseURL: configService.get<string>('AI_BASE_URL') || undefined,
            organization:
              configService.get<string>('AI_ORGANIZATION') || undefined,
            project: configService.get<string>('AI_PROJECT') || undefined,
          });
          return new OpenAiProvider(client);
        }
        return new EchoAiProvider();
      },
      inject: [ConfigService],
    },
  ],
})
export class AssistantModule {}
