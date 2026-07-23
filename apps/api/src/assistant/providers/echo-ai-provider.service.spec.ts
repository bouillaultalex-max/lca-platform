import { EchoAiProvider } from './echo-ai-provider.service';
import type { AiProviderStreamChunk } from './ai-provider.interface';

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

  it('reprend le dernier message utilisateur dans sa réponse simulée', async () => {
    const chunks = await collect(
      provider.streamResponse(
        [{ role: 'user', content: 'Bonjour' }],
        [],
        { model: 'stub-echo', maxOutputTokens: 256 },
        new AbortController().signal,
      ),
    );

    const text = chunks
      .filter(
        (chunk): chunk is Extract<AiProviderStreamChunk, { type: 'text' }> =>
          chunk.type === 'text',
      )
      .map((chunk) => chunk.delta)
      .join('');

    expect(text).toContain('Bonjour');
    expect(chunks[chunks.length - 1]).toEqual({ type: 'done' });
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
  });
});
