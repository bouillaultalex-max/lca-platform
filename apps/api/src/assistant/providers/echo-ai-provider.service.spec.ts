import { EchoAiProvider } from './echo-ai-provider.service';
import type {
  AiProviderMessage,
  AiProviderStreamChunk,
} from './ai-provider.interface';
import type { AiToolSpec } from './ai-tool-spec';

const DASHBOARD_TOOL: AiToolSpec = {
  name: 'dashboard.getSummary',
  description: 'Résumé du tableau de bord.',
  inputSchema: { type: 'object', properties: {} },
};
const STOCK_TOOL: AiToolSpec = {
  name: 'stock.listLowStockItems',
  description: 'Articles en stock faible.',
  inputSchema: { type: 'object', properties: {} },
};

describe('EchoAiProvider', () => {
  let provider: EchoAiProvider;

  beforeEach(() => {
    provider = new EchoAiProvider();
  });

  async function collect(
    stream: AsyncIterable<AiProviderStreamChunk>,
  ): Promise<AiProviderStreamChunk[]> {
    const events: AiProviderStreamChunk[] = [];
    for await (const event of stream) events.push(event);
    return events;
  }

  function textOf(chunks: AiProviderStreamChunk[]): string {
    return chunks
      .filter(
        (chunk): chunk is Extract<AiProviderStreamChunk, { type: 'text' }> =>
          chunk.type === 'text',
      )
      .map((chunk) => chunk.delta)
      .join('');
  }

  it('reprend le dernier message utilisateur dans sa réponse simulée quand aucun outil ne correspond', async () => {
    const chunks = await collect(
      provider.streamResponse(
        [{ role: 'user', content: 'Bonjour' }],
        [],
        { model: 'stub-echo', maxOutputTokens: 256 },
        new AbortController().signal,
      ),
    );

    expect(textOf(chunks)).toContain('Bonjour');
    expect(chunks[chunks.length - 1]).toEqual({ type: 'done' });
    expect(chunks.some((c) => c.type === 'tool_call')).toBe(false);
  });

  it("répond sans planter s'il n'y a aucun message utilisateur", async () => {
    const chunks = await collect(
      provider.streamResponse(
        [],
        [],
        { model: 'stub-echo', maxOutputTokens: 256 },
        new AbortController().signal,
      ),
    );

    expect(chunks[chunks.length - 1]).toEqual({ type: 'done' });
  });

  describe('simulation déterministe du tool calling (AI-04)', () => {
    it('émet un tool_call quand le dernier message utilisateur contient le nom exact d’un outil', async () => {
      const chunks = await collect(
        provider.streamResponse(
          [{ role: 'user', content: 'Teste dashboard.getSummary stp' }],
          [DASHBOARD_TOOL, STOCK_TOOL],
          { model: 'stub-echo', maxOutputTokens: 256 },
          new AbortController().signal,
        ),
      );

      const toolCalls = chunks.filter(
        (c): c is Extract<AiProviderStreamChunk, { type: 'tool_call' }> =>
          c.type === 'tool_call',
      );
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0]).toEqual(
        expect.objectContaining({ name: 'dashboard.getSummary', input: {} }),
      );
      expect(chunks[chunks.length - 1]).toEqual({ type: 'done' });
    });

    it('émet un tool_call par outil trouvé quand plusieurs noms figurent dans le message (multi-outils)', async () => {
      const chunks = await collect(
        provider.streamResponse(
          [
            {
              role: 'user',
              content:
                'Appelle dashboard.getSummary et stock.listLowStockItems',
            },
          ],
          [DASHBOARD_TOOL, STOCK_TOOL],
          { model: 'stub-echo', maxOutputTokens: 256 },
          new AbortController().signal,
        ),
      );

      const toolCalls = chunks.filter(
        (c): c is Extract<AiProviderStreamChunk, { type: 'tool_call' }> =>
          c.type === 'tool_call',
      );
      expect(toolCalls.map((c) => c.name)).toEqual([
        'dashboard.getSummary',
        'stock.listLowStockItems',
      ]);
      // Identifiants de corrélation distincts pour chaque appel.
      expect(new Set(toolCalls.map((c) => c.id)).size).toBe(2);
    });

    it('produit un texte final déterministe quand rappelé avec des tool_result en fin d’historique, sans nouvel appel d’outil', async () => {
      const messages: AiProviderMessage[] = [
        { role: 'user', content: 'Teste dashboard.getSummary' },
        {
          role: 'assistant_tool_call',
          toolCalls: [
            { id: 'echo-call-1', name: 'dashboard.getSummary', input: {} },
          ],
        },
        {
          role: 'tool_result',
          toolCallId: 'echo-call-1',
          name: 'dashboard.getSummary',
          payload: { success: true, result: { articlesCount: 3 } },
        },
      ];

      const chunks = await collect(
        provider.streamResponse(
          messages,
          [DASHBOARD_TOOL],
          { model: 'stub-echo', maxOutputTokens: 256 },
          new AbortController().signal,
        ),
      );

      expect(chunks.some((c) => c.type === 'tool_call')).toBe(false);
      expect(textOf(chunks)).toContain('1 appel(s)');
      expect(textOf(chunks)).toContain('1 succès');
      expect(chunks[chunks.length - 1]).toEqual({ type: 'done' });
    });

    it('compte correctement les échecs dans le texte final', async () => {
      const messages: AiProviderMessage[] = [
        { role: 'user', content: 'Teste stock.getArticleAvailability' },
        {
          role: 'assistant_tool_call',
          toolCalls: [
            {
              id: 'echo-call-1',
              name: 'stock.getArticleAvailability',
              input: {},
            },
          ],
        },
        {
          role: 'tool_result',
          toolCallId: 'echo-call-1',
          name: 'stock.getArticleAvailability',
          payload: { success: false, error: 'Paramètres invalides.' },
        },
      ];

      const chunks = await collect(
        provider.streamResponse(
          messages,
          [],
          { model: 'stub-echo', maxOutputTokens: 256 },
          new AbortController().signal,
        ),
      );

      expect(textOf(chunks)).toContain('0 succès');
      expect(textOf(chunks)).toContain('1 échec(s)');
    });

    it('ne déclenche aucun outil si le message ne contient aucun nom exact', async () => {
      const chunks = await collect(
        provider.streamResponse(
          [{ role: 'user', content: 'Montre-moi le tableau de bord' }],
          [DASHBOARD_TOOL],
          { model: 'stub-echo', maxOutputTokens: 256 },
          new AbortController().signal,
        ),
      );

      expect(chunks.some((c) => c.type === 'tool_call')).toBe(false);
    });
  });

  describe('annulation (AbortSignal)', () => {
    it("ne produit aucun fragment si le signal est déjà annulé avant l'appel", async () => {
      const controller = new AbortController();
      controller.abort();

      const chunks = await collect(
        provider.streamResponse(
          [{ role: 'user', content: 'Bonjour' }],
          [],
          { model: 'stub-echo', maxOutputTokens: 256 },
          controller.signal,
        ),
      );

      expect(chunks).toEqual([]);
    });

    it('cesse de produire des fragments dès que le signal est annulé en cours de flux', async () => {
      const controller = new AbortController();
      const iterator = provider
        .streamResponse(
          [{ role: 'user', content: 'Un message avec plusieurs mots' }],
          [],
          { model: 'stub-echo', maxOutputTokens: 256 },
          controller.signal,
        )
        [Symbol.asyncIterator]();

      const first = await iterator.next();
      expect(first.done).toBe(false);

      controller.abort();

      const afterAbort = await iterator.next();
      expect(afterAbort.done).toBe(true);
    });

    it("cesse d'émettre des tool_call dès que le signal est annulé en cours d'émission", async () => {
      const controller = new AbortController();
      const iterator = provider
        .streamResponse(
          [{ role: 'user', content: 'Teste dashboard.getSummary' }],
          [DASHBOARD_TOOL, STOCK_TOOL],
          { model: 'stub-echo', maxOutputTokens: 256 },
          controller.signal,
        )
        [Symbol.asyncIterator]();

      // Consomme le texte introductif jusqu'au premier tool_call attendu, puis annule.
      let result = await iterator.next();
      while (!result.done && result.value.type === 'text') {
        result = await iterator.next();
      }
      controller.abort();

      const after = await iterator.next();
      expect(after.done).toBe(true);
    });
  });
});
