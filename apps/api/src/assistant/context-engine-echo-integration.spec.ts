import { ConfigService } from '@nestjs/config';
import { ContextEngine } from './context-engine.service';
import { EchoAiProvider } from './providers/echo-ai-provider.service';
import type { Clock } from './context/clock';
import type { AiToolSpec } from './providers/ai-tool-spec';
import type { AiProviderStreamChunk } from './providers/ai-provider.interface';

/**
 * Vérifie que la sortie de `ContextEngine.prepare()` (AI-05) reste
 * exploitable telle quelle par un `AiProvider` existant (AI-04), sans aucune
 * adaptation — preuve que `AiProviderRequest` ne dépend d'aucun format
 * spécifique et que l'ajout du rôle `system` n'a rien cassé côté fournisseur.
 */
describe('Intégration ContextEngine → EchoAiProvider', () => {
  const DASHBOARD_TOOL: AiToolSpec = {
    name: 'dashboard.getSummary',
    description: 'Résumé du tableau de bord.',
    inputSchema: { type: 'object', properties: {} },
  };

  function fakeConfigService(): ConfigService {
    const values: Record<string, number> = {
      AI_CONTEXT_MAX_TOKENS: 100_000,
      AI_CONTEXT_MAX_MESSAGES: 100,
      AI_CONTEXT_MAX_MESSAGE_CHARS: 4000,
      AI_CONTEXT_RECENT_MESSAGES_MIN: 6,
    };
    return { get: (key: string) => values[key] } as unknown as ConfigService;
  }

  function fixedClock(): Clock {
    return { now: () => new Date('2026-07-24T10:42:00.000Z') };
  }

  async function collect(
    stream: AsyncIterable<AiProviderStreamChunk>,
  ): Promise<AiProviderStreamChunk[]> {
    const events: AiProviderStreamChunk[] = [];
    for await (const event of stream) events.push(event);
    return events;
  }

  it("le préfixe system/contexte n'interfère pas avec la détection du dernier message utilisateur d'EchoAiProvider", async () => {
    const contextEngine = new ContextEngine(fakeConfigService(), fixedClock());
    const provider = new EchoAiProvider();

    const request = contextEngine.prepare({
      history: [],
      newUserMessage: 'Teste dashboard.getSummary',
      toolCatalog: [DASHBOARD_TOOL],
      options: { model: 'stub-echo', maxOutputTokens: 256 },
    });

    const messages = [request.system, request.context, ...request.messages];
    const chunks = await collect(
      provider.streamResponse(
        messages,
        request.tools,
        request.options,
        new AbortController().signal,
      ),
    );

    expect(chunks.some((c) => c.type === 'tool_call')).toBe(true);
    expect(chunks[chunks.length - 1]).toEqual({ type: 'done' });
  });

  it("le rôle system ne perturbe pas l'écho par défaut (aucun outil demandé)", async () => {
    const contextEngine = new ContextEngine(fakeConfigService(), fixedClock());
    const provider = new EchoAiProvider();

    const request = contextEngine.prepare({
      history: [],
      newUserMessage: 'Bonjour',
      toolCatalog: [],
      options: { model: 'stub-echo', maxOutputTokens: 256 },
    });

    const messages = [request.system, request.context, ...request.messages];
    const chunks = await collect(
      provider.streamResponse(
        messages,
        request.tools,
        request.options,
        new AbortController().signal,
      ),
    );

    const text = chunks
      .filter(
        (c): c is Extract<AiProviderStreamChunk, { type: 'text' }> =>
          c.type === 'text',
      )
      .map((c) => c.delta)
      .join('');
    expect(text).toContain('Bonjour');
  });
});
