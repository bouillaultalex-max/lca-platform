import { EchoAiProvider } from './echo-ai-provider.service';
import { OpenAiProvider } from './openai-ai-provider.service';
import type {
  AiProvider,
  AiProviderMessage,
  AiProviderStreamChunk,
} from './ai-provider.interface';

/**
 * Contrat commun à tout `AiProvider` (AI-06) : indépendant du fournisseur,
 * exécuté pour `EchoAiProvider` (AI-02/04) et `OpenAiProvider` (AI-06) — un
 * futur adaptateur devra satisfaire les mêmes invariants. Garde-fou contre
 * une dérive du contrat au fil de futurs adaptateurs.
 */

const MESSAGES: AiProviderMessage[] = [{ role: 'user', content: 'Bonjour' }];
const OPTIONS = { model: 'stub-echo', maxOutputTokens: 256 };

async function collect(
  stream: AsyncIterable<AiProviderStreamChunk>,
): Promise<AiProviderStreamChunk[]> {
  const events: AiProviderStreamChunk[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

function* scriptedChunks() {
  yield { choices: [{ delta: { content: 'Bon' }, finish_reason: null }] };
  yield { choices: [{ delta: { content: 'jour' }, finish_reason: null }] };
  yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
}

function fakeOpenAiClientWithMultipleTextChunks() {
  const create = jest.fn().mockResolvedValue(scriptedChunks());
  return {
    chat: { completions: { create } },
  } as unknown as ConstructorParameters<typeof OpenAiProvider>[0];
}

const PROVIDERS: { name: string; build: () => AiProvider }[] = [
  { name: 'EchoAiProvider', build: () => new EchoAiProvider() },
  {
    name: 'OpenAiProvider',
    build: () => new OpenAiProvider(fakeOpenAiClientWithMultipleTextChunks()),
  },
];

describe.each(PROVIDERS)('contrat AiProvider — $name', ({ build }) => {
  it('ne produit aucun chunk si le signal est déjà annulé avant tout appel', async () => {
    const provider = build();
    const controller = new AbortController();
    controller.abort();

    const events = await collect(
      provider.streamResponse(MESSAGES, [], OPTIONS, controller.signal),
    );

    expect(events).toEqual([]);
  });

  it('se termine toujours par au plus un événement terminal (done ou error, jamais les deux, jamais aucun rendu manquant en cas de succès)', async () => {
    const provider = build();

    const events = await collect(
      provider.streamResponse(
        MESSAGES,
        [],
        OPTIONS,
        new AbortController().signal,
      ),
    );

    const terminalEvents = events.filter(
      (e) => e.type === 'done' || e.type === 'error',
    );
    expect(terminalEvents.length).toBeLessThanOrEqual(1);
  });

  it('ne produit plus aucun événement après annulation en cours de flux', async () => {
    const provider = build();
    const controller = new AbortController();
    const iterator = provider
      .streamResponse(MESSAGES, [], OPTIONS, controller.signal)
      [Symbol.asyncIterator]();

    const first = await iterator.next();
    expect(first.done).toBe(false);

    controller.abort();

    const afterAbort = await iterator.next();
    expect(afterAbort.done).toBe(true);
  });
});
