import {
  mapMessagesToOpenAi,
  mapToolsToOpenAi,
} from './openai-message-mapper.util';
import { buildOpenAiToolNameCodec } from './openai-tool-name-codec.util';
import type { AiProviderMessage } from './ai-provider.interface';
import type { AiToolSpec } from './ai-tool-spec';

describe('mapMessagesToOpenAi', () => {
  const codec = buildOpenAiToolNameCodec([
    {
      name: 'dashboard.getSummary',
      description: '',
      inputSchema: { type: 'object', properties: {} },
    },
  ]);

  it('mappe system/user/assistant directement', () => {
    const messages: AiProviderMessage[] = [
      { role: 'system', content: 'Instructions.' },
      { role: 'user', content: 'Bonjour' },
      { role: 'assistant', content: 'Salut' },
    ];

    expect(mapMessagesToOpenAi(messages, codec)).toEqual([
      { role: 'system', content: 'Instructions.' },
      { role: 'user', content: 'Bonjour' },
      { role: 'assistant', content: 'Salut' },
    ]);
  });

  it('mappe assistant_tool_call en message assistant avec tool_calls, nom traduit et arguments sérialisés', () => {
    const messages: AiProviderMessage[] = [
      {
        role: 'assistant_tool_call',
        toolCalls: [
          { id: 'call-1', name: 'dashboard.getSummary', input: { query: 'x' } },
        ],
      },
    ];

    expect(mapMessagesToOpenAi(messages, codec)).toEqual([
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call-1',
            type: 'function',
            function: {
              name: 'dashboard_getSummary',
              arguments: '{"query":"x"}',
            },
          },
        ],
      },
    ]);
  });

  it('mappe tool_result succès en message tool avec contenu sérialisé', () => {
    const messages: AiProviderMessage[] = [
      {
        role: 'tool_result',
        toolCallId: 'call-1',
        name: 'dashboard.getSummary',
        payload: { success: true, result: { articlesCount: 3 } },
      },
    ];

    expect(mapMessagesToOpenAi(messages, codec)).toEqual([
      {
        role: 'tool',
        tool_call_id: 'call-1',
        content: JSON.stringify({ articlesCount: 3 }),
      },
    ]);
  });

  it('mappe tool_result échec en message tool avec l’erreur sérialisée, jamais inventée', () => {
    const messages: AiProviderMessage[] = [
      {
        role: 'tool_result',
        toolCallId: 'call-1',
        name: 'dashboard.getSummary',
        payload: { success: false, error: 'Lot introuvable.' },
      },
    ];

    expect(mapMessagesToOpenAi(messages, codec)).toEqual([
      {
        role: 'tool',
        tool_call_id: 'call-1',
        content: JSON.stringify({ error: 'Lot introuvable.' }),
      },
    ]);
  });
});

describe('mapToolsToOpenAi', () => {
  const codec = buildOpenAiToolNameCodec([
    {
      name: 'stock.getArticleAvailability',
      description: 'Recherche un article.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Texte recherché.',
            minLength: 1,
          },
        },
        required: ['query'],
      },
    },
  ]);

  it('traduit un AiToolSpec en ChatCompletionTool sans perte de schéma', () => {
    const tools: AiToolSpec[] = [
      {
        name: 'stock.getArticleAvailability',
        description: 'Recherche un article.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Texte recherché.',
              minLength: 1,
            },
          },
          required: ['query'],
        },
      },
    ];

    expect(mapToolsToOpenAi(tools, codec)).toEqual([
      {
        type: 'function',
        function: {
          name: 'stock_getArticleAvailability',
          description: 'Recherche un article.',
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Texte recherché.',
                minLength: 1,
              },
            },
            required: ['query'],
            additionalProperties: false,
          },
        },
      },
    ]);
  });

  it('ne déclare pas de required si aucun champ obligatoire (outil sans paramètre)', () => {
    const tools: AiToolSpec[] = [
      {
        name: 'dashboard.getSummary',
        description: 'Résumé.',
        inputSchema: { type: 'object', properties: {} },
      },
    ];
    const noParamCodec = buildOpenAiToolNameCodec(tools);

    const [mapped] = mapToolsToOpenAi(tools, noParamCodec);
    if (mapped.type !== 'function') throw new Error('expected a function tool');
    expect(mapped.function.parameters).not.toHaveProperty('required');
  });
});
