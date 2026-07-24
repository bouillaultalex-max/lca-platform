import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  ToolCallingOrchestrator,
  type ToolCallingContext,
  type ToolCallingEvent,
} from './tool-calling-orchestrator.service';
import {
  AI_PROVIDER,
  type AiProviderMessage,
  type AiProviderStreamChunk,
} from './providers/ai-provider.interface';
import { ToolRegistryService } from './tools/tool-registry.service';
import { ToolExecutorService } from './tools/tool-executor.service';
import { ContextEngine } from './context-engine.service';
import type { AiProviderRequest } from './context/ai-provider-request';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { UserRole } from '../../generated/prisma/client';

const SYSTEM_MESSAGE: AiProviderMessage = { role: 'system', content: 'SYSTEM' };
const CONTEXT_MESSAGE: AiProviderMessage = {
  role: 'system',
  content: 'CONTEXT',
};

const ZERO_METADATA = {
  estimatedTokens: 0,
  messageCount: 0,
  systemMessageCount: 2,
  historicalMessageCount: 0,
  discardedHistoricalMessageCount: 0,
  toolCallCount: 0,
  toolResultCount: 0,
  summaryIncluded: false,
  truncatedMessageCount: 0,
  truncatedCharacterCount: 0,
  preparationDurationMs: 0,
};

describe('ToolCallingOrchestrator', () => {
  let orchestrator: ToolCallingOrchestrator;
  let aiProvider: { streamResponse: jest.Mock };
  let toolRegistry: { list: jest.Mock };
  let toolExecutor: { execute: jest.Mock };
  let contextEngine: { prepare: jest.Mock };
  let configValues: Record<string, unknown>;

  const user: AuthenticatedUser = {
    id: 'user-1',
    siteId: 'site-1',
    fullName: 'Kevin Prian',
    email: 'kevin.prian@lca-mes.local',
    role: UserRole.RESPONSABLE_LABORATOIRE,
    jobTitle: null,
    isSystemAdmin: false,
    mustChangePassword: false,
    lastLoginAt: null,
  };

  const REGISTERED_TOOLS = [
    {
      name: 'dashboard.getSummary',
      description: 'Résumé du tableau de bord.',
      inputSchema: undefined,
      permission: { kind: 'authenticated' as const },
      category: 'read' as const,
      handler: jest.fn(),
    },
    {
      name: 'stock.listLowStockItems',
      description: 'Articles en stock faible.',
      inputSchema: undefined,
      permission: { kind: 'authenticated' as const },
      category: 'read' as const,
      handler: jest.fn(),
    },
  ];

  async function collect(
    gen: AsyncGenerator<ToolCallingEvent>,
  ): Promise<ToolCallingEvent[]> {
    const events: ToolCallingEvent[] = [];
    for await (const event of gen) events.push(event);
    return events;
  }

  function buildContext(
    overrides: Partial<ToolCallingContext> = {},
  ): ToolCallingContext {
    return {
      user,
      signal: new AbortController().signal,
      deadline: Date.now() + 5000,
      ...overrides,
    };
  }

  /** Une suite de tours scriptés : chaque appel successif à `streamResponse`
   * renvoie le prochain tableau de chunks de la liste. */
  function scriptedProvider(turns: AiProviderStreamChunk[][]) {
    let call = 0;
    return jest.fn().mockImplementation(async function* () {
      const chunks = turns[call] ?? [];
      call += 1;
      await Promise.resolve();
      for (const chunk of chunks) yield chunk;
    });
  }

  const OPTIONS = { model: 'stub-echo', maxOutputTokens: 256 };
  const INPUT = { history: [], newUserMessage: 'Salut' };

  beforeEach(async () => {
    aiProvider = {
      streamResponse: scriptedProvider([
        [{ type: 'text', delta: 'Bonjour' }, { type: 'done' }],
      ]),
    };
    toolRegistry = { list: jest.fn().mockReturnValue(REGISTERED_TOOLS) };
    toolExecutor = { execute: jest.fn() };
    // Fake ContextEngine générique : transmet le catalogue reçu et enveloppe
    // le nouveau message utilisateur, comme le ferait le vrai ContextEngine
    // pour un historique vide — les tests de ContextEngine lui-même vivent
    // dans context-engine.service.spec.ts, pas ici.
    contextEngine = {
      prepare: jest.fn().mockImplementation(
        (input: {
          newUserMessage: string;
          toolCatalog: unknown[];
          options: unknown;
        }): AiProviderRequest =>
          ({
            system: SYSTEM_MESSAGE,
            context: CONTEXT_MESSAGE,
            messages: [{ role: 'user', content: input.newUserMessage }],
            tools: input.toolCatalog,
            options: input.options,
            metadata: ZERO_METADATA,
          }) as unknown as AiProviderRequest,
      ),
    };
    configValues = {
      AI_MAX_TOOL_CALLS: 10,
      AI_MAX_TOOL_CALL_TURNS: 5,
      AI_MAX_TOOL_CALL_DEPTH: 5,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ToolCallingOrchestrator,
        { provide: AI_PROVIDER, useValue: aiProvider },
        { provide: ToolRegistryService, useValue: toolRegistry },
        { provide: ToolExecutorService, useValue: toolExecutor },
        { provide: ContextEngine, useValue: contextEngine },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => configValues[key] },
        },
      ],
    }).compile();

    orchestrator = module.get(ToolCallingOrchestrator);
  });

  it('retourne un texte simple sans appel d’outil quand le fournisseur ne demande rien', async () => {
    const events = await collect(
      orchestrator.run(INPUT, OPTIONS, buildContext()),
    );

    expect(events).toEqual([
      { type: 'text', delta: 'Bonjour' },
      { type: 'done' },
    ]);
    expect(toolExecutor.execute).not.toHaveBeenCalled();
  });

  it('appelle ContextEngine.prepare() exactement une fois par échange, quel que soit le nombre de tours', async () => {
    aiProvider.streamResponse = scriptedProvider([
      [
        {
          type: 'tool_call',
          id: 'call-1',
          name: 'dashboard.getSummary',
          input: {},
        },
        { type: 'done' },
      ],
      [
        {
          type: 'tool_call',
          id: 'call-2',
          name: 'stock.listLowStockItems',
          input: {},
        },
        { type: 'done' },
      ],
      [{ type: 'text', delta: 'Terminé.' }, { type: 'done' }],
    ]);
    toolExecutor.execute.mockResolvedValue({});

    await collect(orchestrator.run(INPUT, OPTIONS, buildContext()));

    expect(aiProvider.streamResponse).toHaveBeenCalledTimes(3);
    expect(contextEngine.prepare).toHaveBeenCalledTimes(1);
  });

  it('assemble les messages initiaux dans l’ordre system, contexte, puis messages préparés', async () => {
    await collect(orchestrator.run(INPUT, OPTIONS, buildContext()));

    const [firstCallMessages] = aiProvider.streamResponse.mock.calls[0] as [
      AiProviderMessage[],
    ];
    expect(firstCallMessages).toEqual([
      SYSTEM_MESSAGE,
      CONTEXT_MESSAGE,
      { role: 'user', content: 'Salut' },
    ]);
  });

  it('transmet le catalogue construit depuis le registre (AiToolSpec[], jamais ToolDefinition[]) au fournisseur, via ContextEngine', async () => {
    await collect(orchestrator.run(INPUT, OPTIONS, buildContext()));

    const [prepareInput] = contextEngine.prepare.mock.calls[0] as [
      { toolCatalog: { name: string }[] },
    ];
    expect(prepareInput.toolCatalog.map((t) => t.name)).toContain(
      'dashboard.getSummary',
    );

    const [, tools] = aiProvider.streamResponse.mock.calls[0] as [
      unknown,
      { name: string; inputSchema: unknown }[],
    ];
    expect(tools.map((t) => t.name)).toEqual([
      'dashboard.getSummary',
      'stock.listLowStockItems',
    ]);
    expect(tools[0]).not.toHaveProperty('handler');
    expect(tools[0]).not.toHaveProperty('permission');
  });

  describe('un seul appel d’outil', () => {
    it('exécute l’outil demandé, réinjecte le résultat, et obtient une réponse finale au tour suivant', async () => {
      aiProvider.streamResponse = scriptedProvider([
        [
          {
            type: 'tool_call',
            id: 'call-1',
            name: 'dashboard.getSummary',
            input: {},
          },
          { type: 'done' },
        ],
        [{ type: 'text', delta: 'Voici le résumé.' }, { type: 'done' }],
      ]);
      toolExecutor.execute.mockResolvedValue({ articlesCount: 3 });

      const events = await collect(
        orchestrator.run(INPUT, OPTIONS, buildContext()),
      );

      expect(toolExecutor.execute).toHaveBeenCalledWith(
        user,
        'dashboard.getSummary',
        {},
      );
      expect(events).toEqual([
        { type: 'tool_call', name: 'dashboard.getSummary' },
        { type: 'tool_result', name: 'dashboard.getSummary', success: true },
        { type: 'text', delta: 'Voici le résumé.' },
        { type: 'done' },
      ]);

      // Le résultat brut du service métier n'apparaît jamais dans les
      // événements consommés par AssistantService — uniquement succès/échec.
      expect(JSON.stringify(events)).not.toContain('articlesCount');
    });

    it('réinjecte le résultat de l’outil au fournisseur sous forme de message tool_result, en conservant le préfixe system/contexte', async () => {
      aiProvider.streamResponse = scriptedProvider([
        [
          {
            type: 'tool_call',
            id: 'call-1',
            name: 'dashboard.getSummary',
            input: {},
          },
          { type: 'done' },
        ],
        [{ type: 'done' }],
      ]);
      toolExecutor.execute.mockResolvedValue({ articlesCount: 3 });

      await collect(orchestrator.run(INPUT, OPTIONS, buildContext()));

      const secondCall = aiProvider.streamResponse.mock.calls[1] as [
        AiProviderMessage[],
        unknown,
        unknown,
        unknown,
      ];
      const secondCallMessages = secondCall[0];
      expect(secondCallMessages[0]).toEqual(SYSTEM_MESSAGE);
      expect(secondCallMessages[1]).toEqual(CONTEXT_MESSAGE);
      expect(secondCallMessages).toContainEqual({
        role: 'assistant_tool_call',
        toolCalls: [{ id: 'call-1', name: 'dashboard.getSummary', input: {} }],
      });
      expect(secondCallMessages).toContainEqual({
        role: 'tool_result',
        toolCallId: 'call-1',
        name: 'dashboard.getSummary',
        payload: { success: true, result: { articlesCount: 3 } },
      });
    });
  });

  describe('appels multiples (tests multi-tools)', () => {
    it('exécute deux outils demandés dans le même tour, dans l’ordre, avant de relancer le fournisseur', async () => {
      aiProvider.streamResponse = scriptedProvider([
        [
          {
            type: 'tool_call',
            id: 'call-1',
            name: 'dashboard.getSummary',
            input: {},
          },
          {
            type: 'tool_call',
            id: 'call-2',
            name: 'stock.listLowStockItems',
            input: {},
          },
          { type: 'done' },
        ],
        [{ type: 'text', delta: 'Synthèse.' }, { type: 'done' }],
      ]);
      toolExecutor.execute
        .mockResolvedValueOnce({ articlesCount: 3 })
        .mockResolvedValueOnce([{ articleName: 'Flacon' }]);

      const events = await collect(
        orchestrator.run(INPUT, OPTIONS, buildContext()),
      );

      expect(toolExecutor.execute).toHaveBeenNthCalledWith(
        1,
        user,
        'dashboard.getSummary',
        {},
      );
      expect(toolExecutor.execute).toHaveBeenNthCalledWith(
        2,
        user,
        'stock.listLowStockItems',
        {},
      );
      expect(events).toEqual([
        { type: 'tool_call', name: 'dashboard.getSummary' },
        { type: 'tool_call', name: 'stock.listLowStockItems' },
        { type: 'tool_result', name: 'dashboard.getSummary', success: true },
        { type: 'tool_result', name: 'stock.listLowStockItems', success: true },
        { type: 'text', delta: 'Synthèse.' },
        { type: 'done' },
      ]);
    });

    it('enchaîne deux tours séquentiels (un outil par tour) avant la réponse finale', async () => {
      aiProvider.streamResponse = scriptedProvider([
        [
          {
            type: 'tool_call',
            id: 'call-1',
            name: 'dashboard.getSummary',
            input: {},
          },
          { type: 'done' },
        ],
        [
          {
            type: 'tool_call',
            id: 'call-2',
            name: 'stock.listLowStockItems',
            input: {},
          },
          { type: 'done' },
        ],
        [{ type: 'text', delta: 'Terminé.' }, { type: 'done' }],
      ]);
      toolExecutor.execute.mockResolvedValue({});

      const events = await collect(
        orchestrator.run(INPUT, OPTIONS, buildContext()),
      );

      expect(aiProvider.streamResponse).toHaveBeenCalledTimes(3);
      expect(events.filter((e) => e.type === 'tool_call')).toHaveLength(2);
      expect(events[events.length - 2]).toEqual({
        type: 'text',
        delta: 'Terminé.',
      });
      expect(events[events.length - 1]).toEqual({ type: 'done' });
    });
  });

  describe('erreurs d’outil (jamais des erreurs de transport)', () => {
    it("convertit l'échec d'exécution d'un outil en tool_result success:false et poursuit l'échange", async () => {
      aiProvider.streamResponse = scriptedProvider([
        [
          {
            type: 'tool_call',
            id: 'call-1',
            name: 'dashboard.getSummary',
            input: {},
          },
          { type: 'done' },
        ],
        [{ type: 'text', delta: 'Désolé, échec.' }, { type: 'done' }],
      ]);
      toolExecutor.execute.mockRejectedValue(
        new ForbiddenException(
          "Vous n'avez pas les droits nécessaires pour utiliser cet outil.",
        ),
      );

      const events = await collect(
        orchestrator.run(INPUT, OPTIONS, buildContext()),
      );

      expect(events).toContainEqual({
        type: 'tool_result',
        name: 'dashboard.getSummary',
        success: false,
      });
      expect(events[events.length - 1]).toEqual({ type: 'done' });
      // Jamais un événement 'error' pour une erreur d'outil.
      expect(events.some((e) => e.type === 'error')).toBe(false);
    });

    it('sécurité : un nom d’outil inconnu (halluciné par le fournisseur) devient un tool_result en échec, jamais un crash', async () => {
      aiProvider.streamResponse = scriptedProvider([
        [
          {
            type: 'tool_call',
            id: 'call-1',
            name: 'outil.inexistant',
            input: {},
          },
          { type: 'done' },
        ],
        [{ type: 'done' }],
      ]);
      toolExecutor.execute.mockRejectedValue(
        new NotFoundException('Outil "outil.inexistant" introuvable.'),
      );

      const events = await collect(
        orchestrator.run(INPUT, OPTIONS, buildContext()),
      );

      expect(events).toContainEqual({
        type: 'tool_result',
        name: 'outil.inexistant',
        success: false,
      });
      expect(events.some((e) => e.type === 'error')).toBe(false);
    });

    it('renvoie le message d’erreur métier réel dans le message tool_result réinjecté (jamais inventé)', async () => {
      aiProvider.streamResponse = scriptedProvider([
        [
          {
            type: 'tool_call',
            id: 'call-1',
            name: 'dashboard.getSummary',
            input: {},
          },
          { type: 'done' },
        ],
        [{ type: 'done' }],
      ]);
      toolExecutor.execute.mockRejectedValue(
        new Error('Lot 000000 introuvable.'),
      );

      await collect(orchestrator.run(INPUT, OPTIONS, buildContext()));

      const secondCall = aiProvider.streamResponse.mock.calls[1] as [
        AiProviderMessage[],
        unknown,
        unknown,
        unknown,
      ];
      const secondCallMessages = secondCall[0];
      expect(secondCallMessages).toContainEqual({
        role: 'tool_result',
        toolCallId: 'call-1',
        name: 'dashboard.getSummary',
        payload: { success: false, error: 'Lot 000000 introuvable.' },
      });
    });
  });

  describe('limites (inchangées depuis AI-04)', () => {
    it("arrête l'échange avec un message explicite au-delà du nombre maximal de tours", async () => {
      configValues.AI_MAX_TOOL_CALL_TURNS = 2;
      configValues.AI_MAX_TOOL_CALL_DEPTH = 10;
      aiProvider.streamResponse = scriptedProvider([
        [
          {
            type: 'tool_call',
            id: 'call-1',
            name: 'dashboard.getSummary',
            input: {},
          },
          { type: 'done' },
        ],
        [
          {
            type: 'tool_call',
            id: 'call-2',
            name: 'dashboard.getSummary',
            input: {},
          },
          { type: 'done' },
        ],
        [{ type: 'text', delta: 'Jamais atteint.' }, { type: 'done' }],
      ]);
      toolExecutor.execute.mockResolvedValue({});

      const events = await collect(
        orchestrator.run(INPUT, OPTIONS, buildContext()),
      );

      expect(events).toContainEqual({
        type: 'error',
        message: 'Nombre maximal de tours de raisonnement atteint.',
      });
      expect(aiProvider.streamResponse).toHaveBeenCalledTimes(2);
    });

    it("arrête l'échange avec un message explicite au-delà de la profondeur maximale d'imbrication (configurable indépendamment des tours)", async () => {
      configValues.AI_MAX_TOOL_CALL_TURNS = 10;
      configValues.AI_MAX_TOOL_CALL_DEPTH = 1;
      aiProvider.streamResponse = scriptedProvider([
        [
          {
            type: 'tool_call',
            id: 'call-1',
            name: 'dashboard.getSummary',
            input: {},
          },
          { type: 'done' },
        ],
        [{ type: 'text', delta: 'Jamais atteint.' }, { type: 'done' }],
      ]);
      toolExecutor.execute.mockResolvedValue({});

      const events = await collect(
        orchestrator.run(INPUT, OPTIONS, buildContext()),
      );

      expect(events).toContainEqual({
        type: 'error',
        message:
          "Profondeur maximale d'imbrication des appels d'outils atteinte.",
      });
      expect(aiProvider.streamResponse).toHaveBeenCalledTimes(1);
    });

    it("arrête l'échange dès que le nombre total d'appels d'outils dépasse la limite, même au sein d'un seul tour", async () => {
      configValues.AI_MAX_TOOL_CALLS = 1;
      aiProvider.streamResponse = scriptedProvider([
        [
          {
            type: 'tool_call',
            id: 'call-1',
            name: 'dashboard.getSummary',
            input: {},
          },
          {
            type: 'tool_call',
            id: 'call-2',
            name: 'stock.listLowStockItems',
            input: {},
          },
          { type: 'done' },
        ],
      ]);
      toolExecutor.execute.mockResolvedValue({});

      const events = await collect(
        orchestrator.run(INPUT, OPTIONS, buildContext()),
      );

      expect(events).toContainEqual({
        type: 'error',
        message: "Nombre maximal d'appels d'outils atteint.",
      });
      // Le premier outil a été exécuté, le second jamais atteint.
      expect(toolExecutor.execute).toHaveBeenCalledTimes(1);
    });
  });

  describe('timeout / deadline globale (inchangée depuis AI-04)', () => {
    it("arrête l'échange si le fournisseur ne répond pas avant l'échéance globale", async () => {
      aiProvider.streamResponse = jest
        .fn()
        .mockImplementation(async function* () {
          await new Promise((resolve) => setTimeout(resolve, 200));
          yield { type: 'text', delta: 'trop tard' };
        });

      const events = await collect(
        orchestrator.run(
          INPUT,
          OPTIONS,
          buildContext({ deadline: Date.now() + 20 }),
        ),
      );

      expect(events).toEqual([
        { type: 'error', message: "L'assistant n'a pas répondu à temps." },
      ]);
    });

    it("l'échéance est globale et partagée : elle n'est pas repoussée à chaque nouveau tour", async () => {
      configValues.AI_MAX_TOOL_CALL_TURNS = 10;
      configValues.AI_MAX_TOOL_CALL_DEPTH = 10;
      aiProvider.streamResponse = scriptedProvider([
        [
          {
            type: 'tool_call',
            id: 'call-1',
            name: 'dashboard.getSummary',
            input: {},
          },
          { type: 'done' },
        ],
      ]);
      toolExecutor.execute.mockResolvedValue({});

      const events = await collect(
        orchestrator.run(
          INPUT,
          OPTIONS,
          // Déjà expirée avant même le premier appel.
          buildContext({ deadline: Date.now() - 1 }),
        ),
      );

      expect(events).toEqual([
        { type: 'error', message: "L'assistant n'a pas répondu à temps." },
      ]);
      expect(aiProvider.streamResponse).not.toHaveBeenCalled();
    });
  });

  describe('annulation (AbortSignal, inchangée depuis AI-04)', () => {
    it('ne produit aucun événement si le signal est déjà annulé', async () => {
      const controller = new AbortController();
      controller.abort();

      const events = await collect(
        orchestrator.run(
          INPUT,
          OPTIONS,
          buildContext({ signal: controller.signal }),
        ),
      );

      expect(events).toEqual([]);
      expect(aiProvider.streamResponse).not.toHaveBeenCalled();
    });

    it("cesse d'exécuter de nouveaux tours dès que le signal est annulé entre deux tours", async () => {
      const controller = new AbortController();
      aiProvider.streamResponse = scriptedProvider([
        [
          {
            type: 'tool_call',
            id: 'call-1',
            name: 'dashboard.getSummary',
            input: {},
          },
          { type: 'done' },
        ],
        [{ type: 'text', delta: 'Jamais atteint.' }, { type: 'done' }],
      ]);
      toolExecutor.execute.mockImplementation(() => {
        controller.abort();
        return Promise.resolve({});
      });

      const events = await collect(
        orchestrator.run(
          INPUT,
          OPTIONS,
          buildContext({ signal: controller.signal }),
        ),
      );

      expect(events.some((e) => e.type === 'done')).toBe(false);
      expect(aiProvider.streamResponse).toHaveBeenCalledTimes(1);
    });

    it('transmet le signal reçu au fournisseur sans le remplacer', async () => {
      const controller = new AbortController();

      await collect(
        orchestrator.run(
          INPUT,
          OPTIONS,
          buildContext({ signal: controller.signal }),
        ),
      );

      const [, , , passedSignal] = aiProvider.streamResponse.mock.calls[0] as [
        unknown,
        unknown,
        unknown,
        AbortSignal,
      ];
      expect(passedSignal).toBe(controller.signal);
    });
  });
});
