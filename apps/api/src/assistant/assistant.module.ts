import { Module } from '@nestjs/common';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { ToolRegistryService } from './tools/tool-registry.service';
import { AI_PROVIDER } from './providers/ai-provider.interface';
import { EchoAiProvider } from './providers/echo-ai-provider.service';

/**
 * Module Assistant (AI-02, infrastructure uniquement). `EchoAiProvider` est un
 * remplaçant temporaire de `AiProvider` (voir providers/echo-ai-provider.service.ts) :
 * remplacer un fournisseur réel plus tard (AI-03+) ne demande de changer que la
 * ligne `useClass` ci-dessous, jamais AssistantService ni AssistantController.
 */
@Module({
  controllers: [AssistantController],
  providers: [
    AssistantService,
    ToolRegistryService,
    { provide: AI_PROVIDER, useClass: EchoAiProvider },
  ],
})
export class AssistantModule {}
