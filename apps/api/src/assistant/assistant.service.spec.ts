import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AssistantService } from './assistant.service';
import {
  ToolCallingOrchestrator,
  type ToolCallingEvent,
} from './tool-calling-orchestrator.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { UserRole } from '../../generated/prisma/client';

describe('AssistantService', () => {
  let service: AssistantService;
  let prisma: {
    aiConversation: { create: jest.Mock; findFirst: jest.Mock };
    aiMessage: { create: jest.Mock; findMany: jest.Mock };
  };
  let orchestrator: { run: jest.Mock };
  let configValues: Record<string, unknown>;
  let signal: AbortSignal;

  const siteId = 'site-1';
  const userId = 'user-1';
  const user: AuthenticatedUser = {
    id: userId,
    siteId,
    fullName: 'Kevin Prian',
    email: 'kevin.prian@lca-mes.local',
    role: UserRole.RESPONSABLE_LABORATOIRE,
    jobTitle: null,
    isSystemAdmin: false,
    mustChangePassword: false,
    lastLoginAt: null,
  };

  async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
    const events: T[] = [];
    for await (const event of gen) events.push(event);
    return events;
  }

  function fakeRun(events: ToolCallingEvent[]) {
    return jest.fn().mockImplementation(async function* () {
      await Promise.resolve();
      for (const event of events) yield event;
    });
  }

  beforeEach(async () => {
    prisma = {
      aiConversation: { create: jest.fn(), findFirst: jest.fn() },
      aiMessage: {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    orchestrator = {
      run: fakeRun([{ type: 'text', delta: 'Bonjour' }, { type: 'done' }]),
    };
    configValues = {
      AI_MODEL: 'stub-echo',
      AI_REQUEST_TIMEOUT_MS: 5000,
      AI_MAX_OUTPUT_TOKENS: 256,
    };
    signal = new AbortController().signal;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssistantService,
        { provide: PrismaService, useValue: prisma },
        { provide: ToolCallingOrchestrator, useValue: orchestrator },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => configValues[key] },
        },
      ],
    }).compile();

    service = module.get(AssistantService);
  });

  it('crée une nouvelle conversation quand aucun conversationId n’est fourni', async () => {
    prisma.aiConversation.create.mockResolvedValue({
      id: 'conv-1',
      siteId,
      userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    prisma.aiMessage.create.mockResolvedValue({});

    const events = await collect(
      service.streamMessage(user, { content: 'Bonjour' }, signal),
    );

    expect(prisma.aiConversation.create).toHaveBeenCalledWith({
      data: { siteId, userId },
    });
    expect(events).toContainEqual({
      type: 'conversation',
      conversationId: 'conv-1',
    });
    expect(events).toContainEqual({ type: 'chunk', delta: 'Bonjour' });
    expect(events).toContainEqual({ type: 'done' });
  });

  it('réutilise une conversation existante appartenant à l’utilisateur', async () => {
    prisma.aiConversation.findFirst.mockResolvedValue({
      id: 'conv-2',
      siteId,
      userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    prisma.aiMessage.create.mockResolvedValue({});

    const events = await collect(
      service.streamMessage(
        user,
        { conversationId: 'conv-2', content: 'Suite' },
        signal,
      ),
    );

    expect(prisma.aiConversation.findFirst).toHaveBeenCalledWith({
      where: { id: 'conv-2', siteId, userId },
    });
    expect(prisma.aiConversation.create).not.toHaveBeenCalled();
    expect(events).toContainEqual({
      type: 'conversation',
      conversationId: 'conv-2',
    });
  });

  it("renvoie une erreur si la conversation demandée n'existe pas pour cet utilisateur/site", async () => {
    prisma.aiConversation.findFirst.mockResolvedValue(null);

    const events = await collect(
      service.streamMessage(
        user,
        { conversationId: 'inconnue', content: 'Salut' },
        signal,
      ),
    );

    expect(events).toEqual([
      { type: 'error', message: 'Conversation inconnue introuvable.' },
    ]);
    expect(prisma.aiMessage.create).not.toHaveBeenCalled();
  });

  it('persiste le message utilisateur puis le message assistant assemblé à partir des fragments', async () => {
    prisma.aiConversation.create.mockResolvedValue({
      id: 'conv-3',
      siteId,
      userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    prisma.aiMessage.create.mockResolvedValue({});
    orchestrator.run = fakeRun([
      { type: 'text', delta: 'Bon' },
      { type: 'text', delta: 'jour' },
      { type: 'done' },
    ]);

    await collect(service.streamMessage(user, { content: 'Salut' }, signal));

    expect(prisma.aiMessage.create).toHaveBeenNthCalledWith(1, {
      data: { conversationId: 'conv-3', role: 'USER', content: 'Salut' },
    });
    expect(prisma.aiMessage.create).toHaveBeenNthCalledWith(2, {
      data: { conversationId: 'conv-3', role: 'ASSISTANT', content: 'Bonjour' },
    });
  });

  it('transmet uniquement l’historique USER/ASSISTANT (jamais TOOL_CALL) et le signal à l’orchestrateur', async () => {
    prisma.aiConversation.findFirst.mockResolvedValue({
      id: 'conv-4',
      siteId,
      userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    prisma.aiMessage.create.mockResolvedValue({});
    prisma.aiMessage.findMany.mockResolvedValue([
      { role: 'USER', content: 'Précédent' },
      { role: 'ASSISTANT', content: 'Réponse précédente' },
      { role: 'TOOL_CALL', content: '', toolName: 'dashboard.getSummary' },
      { role: 'USER', content: 'Salut' },
    ]);

    await collect(
      service.streamMessage(
        user,
        { conversationId: 'conv-4', content: 'Salut' },
        signal,
      ),
    );

    expect(orchestrator.run).toHaveBeenCalledWith(
      [
        { role: 'user', content: 'Précédent' },
        { role: 'assistant', content: 'Réponse précédente' },
        { role: 'user', content: 'Salut' },
      ],
      { model: 'stub-echo', maxOutputTokens: 256 },
      expect.objectContaining({ user, signal }),
    );
  });

  it('persiste un message TOOL_CALL (nom uniquement) pour chaque appel d’outil signalé par l’orchestrateur, et diffuse tool_call/tool_result en SSE', async () => {
    prisma.aiConversation.create.mockResolvedValue({
      id: 'conv-5',
      siteId,
      userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    prisma.aiMessage.create.mockResolvedValue({});
    orchestrator.run = fakeRun([
      { type: 'tool_call', name: 'dashboard.getSummary' },
      { type: 'tool_result', name: 'dashboard.getSummary', success: true },
      { type: 'text', delta: 'Voici le résumé.' },
      { type: 'done' },
    ]);

    const events = await collect(
      service.streamMessage(
        user,
        { content: 'Résume-moi le dashboard' },
        signal,
      ),
    );

    expect(prisma.aiMessage.create).toHaveBeenNthCalledWith(2, {
      data: {
        conversationId: 'conv-5',
        role: 'TOOL_CALL',
        content: '',
        toolName: 'dashboard.getSummary',
      },
    });
    expect(events).toContainEqual({
      type: 'tool_call',
      name: 'dashboard.getSummary',
    });
    expect(events).toContainEqual({
      type: 'tool_result',
      name: 'dashboard.getSummary',
      success: true,
    });
    // Jamais de résultat d'outil persisté (voir consigne AI-04) : seuls USER,
    // TOOL_CALL et ASSISTANT sont écrits, jamais un 4e appel pour le résultat.
    expect(prisma.aiMessage.create).toHaveBeenCalledTimes(3);
  });

  it('renvoie une erreur générique si l’orchestrateur signale une erreur, sans persister de message assistant', async () => {
    prisma.aiConversation.create.mockResolvedValue({
      id: 'conv-6',
      siteId,
      userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    prisma.aiMessage.create.mockResolvedValue({});
    orchestrator.run = fakeRun([{ type: 'error', message: 'panne simulée' }]);

    const events = await collect(
      service.streamMessage(user, { content: 'Salut' }, signal),
    );

    expect(events).toContainEqual({
      type: 'error',
      message: 'Une erreur est survenue pendant la génération de la réponse.',
    });
    // Seul le message utilisateur a été persisté, jamais de réponse assistant.
    expect(prisma.aiMessage.create).toHaveBeenCalledTimes(1);
  });

  it('ne diffuse pas d’événement "done" si l’orchestrateur ne l’a jamais émis (ex: annulation)', async () => {
    prisma.aiConversation.create.mockResolvedValue({
      id: 'conv-7',
      siteId,
      userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    prisma.aiMessage.create.mockResolvedValue({});
    orchestrator.run = fakeRun([{ type: 'text', delta: 'partiel' }]);

    const events = await collect(
      service.streamMessage(user, { content: 'Salut' }, signal),
    );

    expect(events.some((e) => e.type === 'done')).toBe(false);
    // Le texte partiel est néanmoins persisté.
    expect(prisma.aiMessage.create).toHaveBeenCalledWith({
      data: { conversationId: 'conv-7', role: 'ASSISTANT', content: 'partiel' },
    });
  });

  describe('contexte transmis à l’orchestrateur', () => {
    it('calcule une échéance globale (deadline) à partir de AI_REQUEST_TIMEOUT_MS', async () => {
      prisma.aiConversation.create.mockResolvedValue({
        id: 'conv-8',
        siteId,
        userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      prisma.aiMessage.create.mockResolvedValue({});
      const before = Date.now();

      await collect(service.streamMessage(user, { content: 'Salut' }, signal));

      const [, , context] = orchestrator.run.mock.calls[0] as [
        unknown,
        unknown,
        { deadline: number },
      ];
      expect(context.deadline).toBeGreaterThanOrEqual(before + 5000);
      expect(context.deadline).toBeLessThanOrEqual(Date.now() + 5000);
    });

    it('transmet le signal reçu sans le remplacer', async () => {
      prisma.aiConversation.create.mockResolvedValue({
        id: 'conv-9',
        siteId,
        userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      prisma.aiMessage.create.mockResolvedValue({});
      const controller = new AbortController();

      await collect(
        service.streamMessage(user, { content: 'Salut' }, controller.signal),
      );

      const [, , context] = orchestrator.run.mock.calls[0] as [
        unknown,
        unknown,
        { signal: AbortSignal },
      ];
      expect(context.signal).toBe(controller.signal);
    });
  });
});
