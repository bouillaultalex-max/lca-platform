import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AssistantService } from './assistant.service';
import {
  AI_PROVIDER,
  type AiProviderStreamChunk,
} from './providers/ai-provider.interface';
import { ToolRegistryService } from './tools/tool-registry.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { UserRole } from '../../generated/prisma/client';

describe('AssistantService', () => {
  let service: AssistantService;
  let prisma: {
    aiConversation: { create: jest.Mock; findFirst: jest.Mock };
    aiMessage: { create: jest.Mock; findMany: jest.Mock };
  };
  let aiProvider: { streamResponse: jest.Mock };
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

  function fakeStream(chunks: AiProviderStreamChunk[]) {
    return jest.fn().mockImplementation(async function* () {
      // `await` explicite pour rester un véritable AsyncGenerator (Symbol.asyncIterator,
      // requis par AssistantService), tout en satisfaisant la règle require-await.
      await Promise.resolve();
      for (const chunk of chunks) yield chunk;
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
    aiProvider = {
      streamResponse: fakeStream([
        { type: 'text', delta: 'Bonjour' },
        { type: 'done' },
      ]),
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
        { provide: AI_PROVIDER, useValue: aiProvider },
        ToolRegistryService,
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
    aiProvider.streamResponse = fakeStream([
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

  it('transmet la liste des outils du registre (vide dans ce test, ToolRegistryService fraîchement instancié) et le signal au fournisseur', async () => {
    prisma.aiConversation.create.mockResolvedValue({
      id: 'conv-4',
      siteId,
      userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    prisma.aiMessage.create.mockResolvedValue({});

    await collect(service.streamMessage(user, { content: 'Salut' }, signal));

    expect(aiProvider.streamResponse).toHaveBeenCalledWith(
      expect.any(Array),
      [],
      {
        model: 'stub-echo',
        maxOutputTokens: 256,
      },
      signal,
    );
  });

  it('renvoie une erreur si le fournisseur signale une erreur, sans persister de message assistant', async () => {
    prisma.aiConversation.create.mockResolvedValue({
      id: 'conv-5',
      siteId,
      userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    prisma.aiMessage.create.mockResolvedValue({});
    aiProvider.streamResponse = fakeStream([
      { type: 'error', message: 'panne simulée' },
    ]);

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

  it('renvoie une erreur si le fournisseur dépasse le délai maximal configuré', async () => {
    prisma.aiConversation.create.mockResolvedValue({
      id: 'conv-6',
      siteId,
      userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    prisma.aiMessage.create.mockResolvedValue({});
    configValues.AI_REQUEST_TIMEOUT_MS = 20;
    aiProvider.streamResponse = jest
      .fn()
      .mockImplementation(async function* () {
        await new Promise((resolve) => setTimeout(resolve, 200));
        yield { type: 'text', delta: 'trop tard' };
      });

    const events = await collect(
      service.streamMessage(user, { content: 'Salut' }, signal),
    );

    expect(events).toContainEqual({
      type: 'error',
      message: 'Une erreur est survenue pendant la génération de la réponse.',
    });
  });

  describe('annulation (AbortSignal)', () => {
    it('ne demande aucun fragment au fournisseur si le signal est déjà annulé', async () => {
      prisma.aiConversation.create.mockResolvedValue({
        id: 'conv-7',
        siteId,
        userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      prisma.aiMessage.create.mockResolvedValue({});
      const controller = new AbortController();
      controller.abort();

      const events = await collect(
        service.streamMessage(user, { content: 'Salut' }, controller.signal),
      );

      // Seul l'événement "conversation" est émis : ni fragment, ni "done" (le
      // client est déjà parti, voir AssistantController), ni erreur.
      expect(events).toEqual([
        { type: 'conversation', conversationId: 'conv-7' },
      ]);
      // Le message utilisateur reste persisté (déjà écrit avant la boucle
      // d'appel au fournisseur), mais jamais de réponse assistant.
      expect(prisma.aiMessage.create).toHaveBeenCalledTimes(1);
      expect(prisma.aiMessage.create).toHaveBeenCalledWith({
        data: { conversationId: 'conv-7', role: 'USER', content: 'Salut' },
      });
    });

    it('transmet le signal reçu au fournisseur sans le remplacer', async () => {
      prisma.aiConversation.create.mockResolvedValue({
        id: 'conv-8',
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
