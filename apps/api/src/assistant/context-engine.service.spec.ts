import { ConfigService } from '@nestjs/config';
import { ContextEngine } from './context-engine.service';
import type { AiMessage } from '../../generated/prisma/client';
import type { AiToolSpec } from './providers/ai-tool-spec';
import type { Clock } from './context/clock';

const DASHBOARD_TOOL: AiToolSpec = {
  name: 'dashboard.getSummary',
  description: 'Résumé du tableau de bord.',
  inputSchema: { type: 'object', properties: {} },
};

const DEFAULT_CONFIG: Record<string, number> = {
  AI_CONTEXT_MAX_TOKENS: 100_000,
  AI_CONTEXT_MAX_MESSAGES: 100,
  AI_CONTEXT_MAX_MESSAGE_CHARS: 4000,
  AI_CONTEXT_RECENT_MESSAGES_MIN: 6,
};

function fakeConfigService(
  overrides: Record<string, number> = {},
): ConfigService {
  const values = { ...DEFAULT_CONFIG, ...overrides };
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

function fixedClock(iso = '2026-07-24T10:42:00.000Z'): Clock {
  return { now: () => new Date(iso) };
}

let idCounter = 0;
function buildMessage(overrides: Partial<AiMessage>): AiMessage {
  idCounter += 1;
  return {
    id: `msg-${idCounter}`,
    conversationId: 'conv-1',
    role: 'USER',
    content: '',
    toolName: null,
    createdAt: new Date(2026, 0, 1, 0, 0, idCounter),
    ...overrides,
  };
}

function buildEngine(
  configOverrides: Record<string, number> = {},
): ContextEngine {
  return new ContextEngine(fakeConfigService(configOverrides), fixedClock());
}

const OPTIONS = { model: 'stub-echo', maxOutputTokens: 256 };

describe('ContextEngine', () => {
  describe('conversation vide', () => {
    it('ne conserve que system, contexte et le nouveau message utilisateur', () => {
      const engine = buildEngine();

      const request = engine.prepare({
        history: [],
        newUserMessage: 'Salut',
        toolCatalog: [DASHBOARD_TOOL],
        options: OPTIONS,
      });

      expect(request.system.role).toBe('system');
      expect(request.context.role).toBe('system');
      expect(request.messages).toEqual([{ role: 'user', content: 'Salut' }]);
      expect(request.metadata.historicalMessageCount).toBe(0);
      expect(request.metadata.summaryIncluded).toBe(false);
      expect(request.metadata.systemMessageCount).toBe(2);
    });
  });

  describe('conversation courte', () => {
    it('conserve tout l’historique tel quel quand il tient largement dans le budget', () => {
      const engine = buildEngine();
      const history = [
        buildMessage({ role: 'USER', content: 'Bonjour' }),
        buildMessage({
          role: 'ASSISTANT',
          content: 'Bonjour, comment puis-je vous aider ?',
        }),
      ];

      const request = engine.prepare({
        history,
        newUserMessage: 'Merci',
        toolCatalog: [],
        options: OPTIONS,
      });

      expect(request.metadata.historicalMessageCount).toBe(2);
      expect(request.metadata.discardedHistoricalMessageCount).toBe(0);
      expect(request.metadata.summaryIncluded).toBe(false);
      expect(request.messages).toEqual([
        { role: 'user', content: 'Bonjour' },
        { role: 'assistant', content: 'Bonjour, comment puis-je vous aider ?' },
        { role: 'user', content: 'Merci' },
      ]);
    });
  });

  describe('budget de tokens', () => {
    it('écarte les messages historiques les plus anciens en premier quand le budget de jetons est dépassé', () => {
      const engine = buildEngine({
        AI_CONTEXT_MAX_TOKENS: 40,
        AI_CONTEXT_RECENT_MESSAGES_MIN: 0,
      });
      const history = [
        buildMessage({ role: 'USER', content: 'Ancien message 1' }),
        buildMessage({ role: 'ASSISTANT', content: 'Ancienne réponse 1' }),
        buildMessage({ role: 'USER', content: 'Message récent' }),
        buildMessage({ role: 'ASSISTANT', content: 'Réponse récente' }),
      ];

      const request = engine.prepare({
        history,
        newUserMessage: 'Nouveau',
        toolCatalog: [],
        options: OPTIONS,
      });

      const contents = request.messages.map((m) =>
        'content' in m ? m.content : '',
      );
      expect(contents).not.toContain('Ancien message 1');
      expect(contents).toContain('Nouveau');
    });

    it('ne dépasse jamais AI_CONTEXT_MAX_TOKENS dans le cas courant', () => {
      // Le budget doit rester réaliste : system + contexte statique + le
      // nouveau message représentent déjà un coût fixe incompressible.
      const engine = buildEngine({ AI_CONTEXT_MAX_TOKENS: 150 });
      const history = Array.from({ length: 20 }, (_, i) =>
        buildMessage({
          role: i % 2 === 0 ? 'USER' : 'ASSISTANT',
          content: `Message numéro ${i}`,
        }),
      );

      const request = engine.prepare({
        history,
        newUserMessage: 'Dernier message',
        toolCatalog: [],
        options: OPTIONS,
      });

      expect(request.metadata.estimatedTokens).toBeLessThanOrEqual(150);
    });
  });

  describe('nombre maximal de messages', () => {
    it('limite le nombre total de messages même si le budget de jetons n’est pas dépassé', () => {
      const engine = buildEngine({
        AI_CONTEXT_MAX_TOKENS: 100_000,
        AI_CONTEXT_MAX_MESSAGES: 5,
        AI_CONTEXT_RECENT_MESSAGES_MIN: 0,
      });
      const history = Array.from({ length: 20 }, (_, i) =>
        buildMessage({
          role: i % 2 === 0 ? 'USER' : 'ASSISTANT',
          content: `Message ${i}`,
        }),
      );

      const request = engine.prepare({
        history,
        newUserMessage: 'Dernier',
        toolCatalog: [],
        options: OPTIONS,
      });

      expect(request.metadata.messageCount).toBeLessThanOrEqual(5);
    });
  });

  describe('taille maximale d’un message', () => {
    it('tronque un message historique individuellement trop long', () => {
      const engine = buildEngine({ AI_CONTEXT_MAX_MESSAGE_CHARS: 50 });
      const longContent = 'x'.repeat(500);
      const history = [buildMessage({ role: 'USER', content: longContent })];

      const request = engine.prepare({
        history,
        newUserMessage: 'ok',
        toolCatalog: [],
        options: OPTIONS,
      });

      const historicalMessage = request.messages.find(
        (m) => 'content' in m && m.content.startsWith('x'),
      );
      expect(historicalMessage).toBeDefined();
      if (historicalMessage && 'content' in historicalMessage) {
        expect(historicalMessage.content.length).toBeLessThanOrEqual(50);
      }
      expect(request.metadata.truncatedMessageCount).toBeGreaterThanOrEqual(1);
    });

    it('ne supprime jamais silencieusement le nouveau message utilisateur trop long : il est tronqué avec une indication explicite', () => {
      const engine = buildEngine({ AI_CONTEXT_MAX_MESSAGE_CHARS: 30 });
      const longUserMessage = 'y'.repeat(300);

      const request = engine.prepare({
        history: [],
        newUserMessage: longUserMessage,
        toolCatalog: [],
        options: OPTIONS,
      });

      const userMessage = request.messages[request.messages.length - 1];
      expect(userMessage.role).toBe('user');
      if (userMessage.role === 'user') {
        expect(userMessage.content.length).toBeLessThanOrEqual(30);
        expect(userMessage.content).toContain('tronqué');
        expect(userMessage.content.startsWith('y')).toBe(true);
      }
      expect(request.metadata.truncatedMessageCount).toBe(1);
    });
  });

  describe('résumé déterministe', () => {
    it('déclenche un résumé quand la troncature laisserait moins de messages que le plancher configuré', () => {
      const engine = buildEngine({
        AI_CONTEXT_MAX_MESSAGES: 5,
        AI_CONTEXT_RECENT_MESSAGES_MIN: 3,
      });
      const history = Array.from({ length: 30 }, (_, i) =>
        buildMessage({
          role: i % 2 === 0 ? 'USER' : 'ASSISTANT',
          content: `Message ${i}`,
        }),
      );

      const request = engine.prepare({
        history,
        newUserMessage: 'Dernier',
        toolCatalog: [],
        options: OPTIONS,
      });

      expect(request.metadata.summaryIncluded).toBe(true);
      const summaryMessage = request.messages[0];
      expect(summaryMessage.role).toBe('system');
      if (summaryMessage.role === 'system') {
        expect(summaryMessage.content).toContain('Conversation précédente');
      }
    });

    it("n'injecte jamais plus d'un seul résumé", () => {
      const engine = buildEngine({
        AI_CONTEXT_MAX_MESSAGES: 5,
        AI_CONTEXT_RECENT_MESSAGES_MIN: 3,
      });
      const history = Array.from({ length: 50 }, (_, i) =>
        buildMessage({
          role: i % 2 === 0 ? 'USER' : 'ASSISTANT',
          content: `Message ${i}`,
        }),
      );

      const request = engine.prepare({
        history,
        newUserMessage: 'Dernier',
        toolCatalog: [],
        options: OPTIONS,
      });

      const summaryLikeMessages = request.messages.filter(
        (m) => m.role === 'system',
      );
      expect(summaryLikeMessages).toHaveLength(1);
    });

    it("liste les noms d'outils utilisés (dédupliqués, triés) à partir des lignes TOOL_CALL persistées", () => {
      const engine = buildEngine({
        AI_CONTEXT_MAX_MESSAGES: 4,
        AI_CONTEXT_RECENT_MESSAGES_MIN: 2,
      });
      const history = [
        buildMessage({ role: 'USER', content: 'Question 1' }),
        buildMessage({
          role: 'TOOL_CALL',
          toolName: 'stock.listLowStockItems',
        }),
        buildMessage({ role: 'TOOL_CALL', toolName: 'dashboard.getSummary' }),
        buildMessage({ role: 'ASSISTANT', content: 'Réponse 1' }),
        buildMessage({ role: 'USER', content: 'Question 2' }),
        buildMessage({ role: 'ASSISTANT', content: 'Réponse 2' }),
        buildMessage({ role: 'USER', content: 'Question 3' }),
        buildMessage({ role: 'ASSISTANT', content: 'Réponse 3' }),
      ];

      const request = engine.prepare({
        history,
        newUserMessage: 'Dernier',
        toolCatalog: [],
        options: OPTIONS,
      });

      expect(request.metadata.summaryIncluded).toBe(true);
      const summary = request.messages[0];
      if (summary.role === 'system') {
        expect(summary.content).toContain('dashboard.getSummary');
        expect(summary.content).toContain('stock.listLowStockItems');
      }
    });

    it('ne contient jamais de contenu métier, d’extrait de message ni de paramètre d’outil', () => {
      const engine = buildEngine({
        AI_CONTEXT_MAX_MESSAGES: 4,
        AI_CONTEXT_RECENT_MESSAGES_MIN: 2,
      });
      const history = [
        buildMessage({
          role: 'USER',
          content: 'Le lot 455123 est-il conforme ?',
        }),
        buildMessage({
          role: 'TOOL_CALL',
          toolName: 'traceability.getLotByNumber',
        }),
        buildMessage({
          role: 'ASSISTANT',
          content: 'Le lot 455123 est conforme.',
        }),
        buildMessage({ role: 'USER', content: 'Question 2' }),
        buildMessage({ role: 'ASSISTANT', content: 'Réponse 2' }),
        buildMessage({ role: 'USER', content: 'Question 3' }),
        buildMessage({ role: 'ASSISTANT', content: 'Réponse 3' }),
      ];

      const request = engine.prepare({
        history,
        newUserMessage: 'Dernier',
        toolCatalog: [],
        options: OPTIONS,
      });

      const summary = request.messages[0];
      if (summary.role === 'system') {
        expect(summary.content).not.toContain('455123');
        expect(summary.content).not.toContain('conforme');
      }
    });
  });

  describe('TOOL_CALL persistés', () => {
    it('ne sont jamais rejoués comme des messages user/assistant/tool_result', () => {
      const engine = buildEngine();
      const history = [
        buildMessage({ role: 'USER', content: 'Question' }),
        buildMessage({ role: 'TOOL_CALL', toolName: 'dashboard.getSummary' }),
        buildMessage({ role: 'ASSISTANT', content: 'Réponse' }),
      ];

      const request = engine.prepare({
        history,
        newUserMessage: 'Suite',
        toolCatalog: [],
        options: OPTIONS,
      });

      expect(request.messages.some((m) => m.role === 'tool_result')).toBe(
        false,
      );
      expect(request.metadata.historicalMessageCount).toBe(2); // USER + ASSISTANT uniquement
      expect(request.metadata.toolCallCount).toBe(1);
    });
  });

  describe('catalogue d’outils', () => {
    it('transmet toujours le catalogue reçu intégralement, sans sélection ni filtrage', () => {
      const engine = buildEngine();
      const toolCatalog = [DASHBOARD_TOOL];

      const request = engine.prepare({
        history: [],
        newUserMessage: 'Salut',
        toolCatalog,
        options: OPTIONS,
      });

      expect(request.tools).toBe(toolCatalog);
    });
  });

  describe('contexte statique (horloge injectable)', () => {
    it('est déterministe pour une horloge fixée', () => {
      const engine = new ContextEngine(
        fakeConfigService(),
        fixedClock('2026-07-24T10:42:00.000Z'),
      );

      const requestA = engine.prepare({
        history: [],
        newUserMessage: 'Salut',
        toolCatalog: [],
        options: OPTIONS,
      });
      const requestB = engine.prepare({
        history: [],
        newUserMessage: 'Salut',
        toolCatalog: [],
        options: OPTIONS,
      });

      expect(requestA.context).toEqual(requestB.context);
    });

    it('ne contient jamais de donnée métier ni le nom du site', () => {
      const engine = buildEngine();

      const request = engine.prepare({
        history: [],
        newUserMessage: 'Salut',
        toolCatalog: [],
        options: OPTIONS,
      });

      if (request.context.role === 'system') {
        const lower = request.context.content.toLowerCase();
        for (const forbidden of ['site', 'article', 'lot', 'batch', 'stock']) {
          expect(lower).not.toContain(forbidden);
        }
      }
    });
  });

  describe('métadonnées', () => {
    it('ne journalise jamais elle-même (aucun Logger, aucun effet de bord) et renvoie une métadonnée complète', () => {
      const engine = buildEngine();

      const request = engine.prepare({
        history: [
          buildMessage({ role: 'USER', content: 'Bonjour' }),
          buildMessage({ role: 'ASSISTANT', content: 'Salut' }),
        ],
        newUserMessage: 'Merci',
        toolCatalog: [DASHBOARD_TOOL],
        options: OPTIONS,
      });

      expect(typeof request.metadata.estimatedTokens).toBe('number');
      expect(typeof request.metadata.messageCount).toBe('number');
      expect(typeof request.metadata.preparationDurationMs).toBe('number');
      expect(request.metadata.systemMessageCount).toBe(2);
      expect(request.metadata.historicalMessageCount).toBe(2);
      expect(request.metadata.discardedHistoricalMessageCount).toBe(0);
      expect(request.metadata.toolCallCount).toBe(0);
      expect(request.metadata.toolResultCount).toBe(0);
      expect(request.metadata.summaryIncluded).toBe(false);
      expect(request.metadata.truncatedMessageCount).toBe(0);
      expect(request.metadata.truncatedCharacterCount).toBe(0);
    });
  });

  describe('aucune dépendance Prisma', () => {
    it('se construit avec uniquement ConfigService et une horloge — aucun PrismaService requis', () => {
      expect(
        () => new ContextEngine(fakeConfigService(), fixedClock()),
      ).not.toThrow();
    });
  });
});
