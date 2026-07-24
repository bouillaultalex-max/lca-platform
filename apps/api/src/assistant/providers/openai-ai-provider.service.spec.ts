import { AuthenticationError, RateLimitError } from 'openai';
import { OpenAiProvider } from './openai-ai-provider.service';
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
  name: 'stock.getArticleAvailability',
  description: 'Recherche un article.',
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string', minLength: 1 } },
    required: ['query'],
  },
};

function* scriptedChunks(chunks: unknown[]) {
  yield* chunks;
}

/** Fabrique un faux client OpenAI dont `create()` renvoie l'itérable de
 * chunks fourni (ou lève l'erreur fournie) — aucun appel réseau réel. */
function fakeClient(
  behavior:
    | { chunks: unknown[] }
    | { throws: Error }
    | {
        implementation: (opts: {
          signal?: AbortSignal;
        }) => Iterable<unknown> | AsyncIterable<unknown>;
      },
) {
  const create = jest
    .fn()
    .mockImplementation((_body: unknown, opts?: { signal?: AbortSignal }) => {
      if ('throws' in behavior) return Promise.reject(behavior.throws);
      if ('implementation' in behavior) {
        return Promise.resolve(behavior.implementation(opts ?? {}));
      }
      return Promise.resolve(scriptedChunks(behavior.chunks));
    });
  return { chat: { completions: { create } } };
}

async function collect(
  stream: AsyncIterable<AiProviderStreamChunk>,
): Promise<AiProviderStreamChunk[]> {
  const events: AiProviderStreamChunk[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

const OPTIONS = { model: 'gpt-4o-mini', maxOutputTokens: 256 };
const MESSAGES: AiProviderMessage[] = [{ role: 'user', content: 'Bonjour' }];

describe('OpenAiProvider', () => {
  it('traduit un flux de texte simple en chunks text puis done', async () => {
    const client = fakeClient({
      chunks: [
        { choices: [{ delta: { content: 'Bon' }, finish_reason: null }] },
        { choices: [{ delta: { content: 'jour' }, finish_reason: null }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }] },
      ],
    });
    const provider = new OpenAiProvider(client as never);

    const events = await collect(
      provider.streamResponse(
        MESSAGES,
        [],
        OPTIONS,
        new AbortController().signal,
      ),
    );

    expect(events).toEqual([
      { type: 'text', delta: 'Bon' },
      { type: 'text', delta: 'jour' },
      { type: 'done' },
    ]);
  });

  it('transmet messages/tools/options/signal à client.chat.completions.create', async () => {
    const client = fakeClient({
      chunks: [{ choices: [{ delta: {}, finish_reason: 'stop' }] }],
    });
    const provider = new OpenAiProvider(client as never);
    const controller = new AbortController();

    await collect(
      provider.streamResponse(
        MESSAGES,
        [DASHBOARD_TOOL],
        OPTIONS,
        controller.signal,
      ),
    );

    expect(client.chat.completions.create).toHaveBeenCalledTimes(1);
    const [body, opts] = client.chat.completions.create.mock.calls[0] as [
      {
        model: string;
        messages: unknown[];
        tools?: unknown[];
        stream: boolean;
      },
      { signal: AbortSignal },
    ];
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.stream).toBe(true);
    expect(body.messages).toEqual([{ role: 'user', content: 'Bonjour' }]);
    const tools = body.tools as { type: string; function: { name: string } }[];
    expect(tools).toHaveLength(1);
    expect(tools[0].type).toBe('function');
    expect(tools[0].function.name).toBe('dashboard_getSummary');
    expect(opts.signal).toBe(controller.signal);
  });

  it('omet le champ tools si le catalogue est vide', async () => {
    const client = fakeClient({
      chunks: [{ choices: [{ delta: {}, finish_reason: 'stop' }] }],
    });
    const provider = new OpenAiProvider(client as never);

    await collect(
      provider.streamResponse(
        MESSAGES,
        [],
        OPTIONS,
        new AbortController().signal,
      ),
    );

    const [body] = client.chat.completions.create.mock.calls[0] as [
      { tools?: unknown },
    ];
    expect(body.tools).toBeUndefined();
  });

  describe('Tool Calls', () => {
    it('reconstruit un tool call reçu en un seul fragment', async () => {
      const client = fakeClient({
        chunks: [
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call-1',
                      function: {
                        name: 'dashboard_getSummary',
                        arguments: '{}',
                      },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          },
          { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
        ],
      });
      const provider = new OpenAiProvider(client as never);

      const events = await collect(
        provider.streamResponse(
          MESSAGES,
          [DASHBOARD_TOOL],
          OPTIONS,
          new AbortController().signal,
        ),
      );

      expect(events).toEqual([
        {
          type: 'tool_call',
          id: 'call-1',
          name: 'dashboard.getSummary',
          input: {},
        },
        { type: 'done' },
      ]);
    });

    it('reconstruit un tool call dont les arguments arrivent fragmentés sur plusieurs chunks', async () => {
      const client = fakeClient({
        chunks: [
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call-1',
                      function: { name: 'stock_getArticleAvailability' },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          },
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    { index: 0, function: { arguments: '{"query":' } },
                  ],
                },
                finish_reason: null,
              },
            ],
          },
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    { index: 0, function: { arguments: '"flacon"}' } },
                  ],
                },
                finish_reason: null,
              },
            ],
          },
          { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
        ],
      });
      const provider = new OpenAiProvider(client as never);

      const events = await collect(
        provider.streamResponse(
          MESSAGES,
          [STOCK_TOOL],
          OPTIONS,
          new AbortController().signal,
        ),
      );

      expect(events).toContainEqual({
        type: 'tool_call',
        id: 'call-1',
        name: 'stock.getArticleAvailability',
        input: { query: 'flacon' },
      });
    });

    it('reconstruit plusieurs tool calls demandés dans le même tour, dans l’ordre des index', async () => {
      const client = fakeClient({
        chunks: [
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call-1',
                      function: {
                        name: 'dashboard_getSummary',
                        arguments: '{}',
                      },
                    },
                    {
                      index: 1,
                      id: 'call-2',
                      function: {
                        name: 'stock_getArticleAvailability',
                        arguments: '{"query":"x"}',
                      },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          },
          { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
        ],
      });
      const provider = new OpenAiProvider(client as never);

      const events = await collect(
        provider.streamResponse(
          MESSAGES,
          [DASHBOARD_TOOL, STOCK_TOOL],
          OPTIONS,
          new AbortController().signal,
        ),
      );

      const toolCalls = events.filter(
        (e): e is Extract<AiProviderStreamChunk, { type: 'tool_call' }> =>
          e.type === 'tool_call',
      );
      expect(toolCalls.map((c) => c.name)).toEqual([
        'dashboard.getSummary',
        'stock.getArticleAvailability',
      ]);
    });

    it('convertit un tool call incomplet (nom jamais reçu) en erreur malformed_provider_response, jamais un crash', async () => {
      const client = fakeClient({
        chunks: [
          {
            choices: [
              {
                delta: { tool_calls: [{ index: 0, id: 'call-1' }] },
                finish_reason: null,
              },
            ],
          },
          { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
        ],
      });
      const provider = new OpenAiProvider(client as never);

      const events = await collect(
        provider.streamResponse(
          MESSAGES,
          [DASHBOARD_TOOL],
          OPTIONS,
          new AbortController().signal,
        ),
      );

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('error');
      if (events[0].type === 'error') {
        expect(events[0].message).toContain('malformée');
      }
    });

    it('convertit des arguments JSON invalides en erreur malformed_provider_response', async () => {
      const client = fakeClient({
        chunks: [
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call-1',
                      function: {
                        name: 'dashboard_getSummary',
                        arguments: '{invalide',
                      },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          },
          { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
        ],
      });
      const provider = new OpenAiProvider(client as never);

      const events = await collect(
        provider.streamResponse(
          MESSAGES,
          [DASHBOARD_TOOL],
          OPTIONS,
          new AbortController().signal,
        ),
      );

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('error');
      if (events[0].type === 'error') {
        expect(events[0].message).toContain('malformée');
      }
    });
  });

  describe('finish_reason', () => {
    it('finish_reason "length" devient une erreur incomplete_response, jamais une fin normale', async () => {
      const client = fakeClient({
        chunks: [
          { choices: [{ delta: { content: 'partiel' }, finish_reason: null }] },
          { choices: [{ delta: {}, finish_reason: 'length' }] },
        ],
      });
      const provider = new OpenAiProvider(client as never);

      const events = await collect(
        provider.streamResponse(
          MESSAGES,
          [],
          OPTIONS,
          new AbortController().signal,
        ),
      );

      const last = events[events.length - 1];
      expect(last.type).toBe('error');
      if (last.type === 'error') {
        expect(last.message).toContain('limite de longueur');
      }
      expect(events.some((e) => e.type === 'done')).toBe(false);
    });

    it('finish_reason "content_filter" devient une erreur content_filtered, jamais une fin normale', async () => {
      const client = fakeClient({
        chunks: [{ choices: [{ delta: {}, finish_reason: 'content_filter' }] }],
      });
      const provider = new OpenAiProvider(client as never);

      const events = await collect(
        provider.streamResponse(
          MESSAGES,
          [],
          OPTIONS,
          new AbortController().signal,
        ),
      );

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('error');
      if (events[0].type === 'error') {
        expect(events[0].message).toContain('filtrée');
      }
    });

    it('finish_reason "stop" produit une fin normale (done)', async () => {
      const client = fakeClient({
        chunks: [
          { choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] },
        ],
      });
      const provider = new OpenAiProvider(client as never);

      const events = await collect(
        provider.streamResponse(
          MESSAGES,
          [],
          OPTIONS,
          new AbortController().signal,
        ),
      );

      expect(events[events.length - 1]).toEqual({ type: 'done' });
    });
  });

  describe('erreurs (jamais un détail brut, aucun retry)', () => {
    it("convertit une erreur d'authentification en chunk error générique", async () => {
      const client = fakeClient({
        throws: new AuthenticationError(
          401,
          { message: 'clé invalide sk-xxx' },
          'Unauthorized',
          new Headers(),
        ),
      });
      const provider = new OpenAiProvider(client as never);

      const events = await collect(
        provider.streamResponse(
          MESSAGES,
          [],
          OPTIONS,
          new AbortController().signal,
        ),
      );

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('error');
      if (events[0].type === 'error') {
        expect(events[0].message).not.toContain('sk-xxx');
      }
    });

    it('convertit une erreur de rate limit sans tenter de nouvel appel (aucun retry)', async () => {
      const client = fakeClient({
        throws: new RateLimitError(429, {}, 'Too Many Requests', new Headers()),
      });
      const provider = new OpenAiProvider(client as never);

      await collect(
        provider.streamResponse(
          MESSAGES,
          [],
          OPTIONS,
          new AbortController().signal,
        ),
      );

      expect(client.chat.completions.create).toHaveBeenCalledTimes(1);
    });

    it('ne produit jamais error après done, ni done après error (un seul et un seul résultat terminal)', async () => {
      const client = fakeClient({
        chunks: [
          { choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] },
        ],
      });
      const provider = new OpenAiProvider(client as never);

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
      expect(terminalEvents).toHaveLength(1);
    });
  });

  describe('annulation (AbortSignal)', () => {
    it('ne produit aucun chunk si le signal est déjà annulé avant l’appel', async () => {
      const client = fakeClient({
        chunks: [
          { choices: [{ delta: { content: 'x' }, finish_reason: 'stop' }] },
        ],
      });
      const provider = new OpenAiProvider(client as never);
      const controller = new AbortController();
      controller.abort();

      const events = await collect(
        provider.streamResponse(MESSAGES, [], OPTIONS, controller.signal),
      );

      expect(events).toEqual([]);
      expect(client.chat.completions.create).not.toHaveBeenCalled();
    });

    it('ne produit plus rien après annulation en cours de flux (jamais de chunk après abort)', async () => {
      const controller = new AbortController();
      const client = fakeClient({
        implementation: () =>
          (function* () {
            yield {
              choices: [{ delta: { content: 'premier' }, finish_reason: null }],
            };
            controller.abort();
            yield {
              choices: [
                { delta: { content: 'jamais émis' }, finish_reason: null },
              ],
            };
            yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
          })(),
      });
      const provider = new OpenAiProvider(client as never);

      const events = await collect(
        provider.streamResponse(MESSAGES, [], OPTIONS, controller.signal),
      );

      expect(events).toEqual([{ type: 'text', delta: 'premier' }]);
    });

    it('ne produit pas de chunk error si le client rejette après une annulation', async () => {
      const controller = new AbortController();
      const client = fakeClient({
        implementation: () => {
          controller.abort();
          throw new Error('Request was aborted.');
        },
      });
      const provider = new OpenAiProvider(client as never);

      const events = await collect(
        provider.streamResponse(MESSAGES, [], OPTIONS, controller.signal),
      );

      expect(events).toEqual([]);
    });
  });
});
