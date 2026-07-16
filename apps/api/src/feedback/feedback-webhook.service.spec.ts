import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  FeedbackWebhookService,
  buildFeedbackWebhookPayload,
  type FeedbackWebhookPayload,
} from './feedback-webhook.service';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import {
  Feedback,
  FeedbackPriority,
  FeedbackType,
  UserRole,
} from '../../generated/prisma/client';

/**
 * Toutes les requêtes de ce fichier sont adressées à un serveur HTTP local
 * (127.0.0.1, port éphémère) qui simule Make — jamais à une vraie URL Make.
 */
function startMockServer(handler: http.RequestListener): Promise<{
  server: http.Server;
  url: string;
}> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString()));
    req.on('end', () => resolve(body));
  });
}

async function buildService(
  webhookUrl: string | undefined,
): Promise<FeedbackWebhookService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      FeedbackWebhookService,
      {
        provide: ConfigService,
        useValue: { get: jest.fn().mockReturnValue(webhookUrl) },
      },
    ],
  }).compile();
  return module.get(FeedbackWebhookService);
}

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

const feedback: Feedback = {
  id: 'feedback-1',
  siteId: 'site-1',
  userId: 'user-1',
  type: FeedbackType.BUG,
  priority: FeedbackPriority.NORMALE,
  message: 'Le bouton ne répond pas.',
  pageUrl: '/catalog',
  appVersion: '0.9.0',
  status: 'NOUVEAU',
  createdAt: new Date('2026-01-01T10:00:00.000Z'),
};

describe('FeedbackWebhookService', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  describe('buildFeedbackWebhookPayload', () => {
    it('construit exactement les champs attendus, sans aucun champ supplémentaire', () => {
      const payload = buildFeedbackWebhookPayload(feedback, user);

      expect(Object.keys(payload).sort()).toEqual(
        [
          'createdAt',
          'email',
          'feedbackId',
          'message',
          'page',
          'priority',
          'siteId',
          'status',
          'type',
          'user',
          'version',
        ].sort(),
      );
      expect(payload).toEqual<FeedbackWebhookPayload>({
        feedbackId: feedback.id,
        user: user.fullName,
        email: user.email,
        type: feedback.type,
        priority: feedback.priority,
        page: feedback.pageUrl,
        message: feedback.message,
        version: feedback.appVersion,
        status: feedback.status,
        createdAt: feedback.createdAt.toISOString(),
        siteId: feedback.siteId,
      });
    });
  });

  describe('notify', () => {
    it("n'effectue aucun appel si MAKE_FEEDBACK_WEBHOOK_URL est absente", async () => {
      let requestCount = 0;
      const { server } = await startMockServer((_req, res) => {
        requestCount += 1;
        res.writeHead(200);
        res.end();
      });
      // Le service n'est volontairement PAS configuré avec l'URL du serveur : il
      // ne doit jamais le contacter, qu'on démarre ici uniquement pour prouver
      // qu'aucune requête ne lui parvient.
      const service = await buildService(undefined);

      service.notify(buildFeedbackWebhookPayload(feedback, user));
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(requestCount).toBe(0);
      await closeServer(server);
    });

    it("n'effectue aucun appel si MAKE_FEEDBACK_WEBHOOK_URL est une chaîne vide", async () => {
      let requestCount = 0;
      const { server } = await startMockServer((_req, res) => {
        requestCount += 1;
        res.writeHead(200);
        res.end();
      });
      const service = await buildService('');

      service.notify(buildFeedbackWebhookPayload(feedback, user));
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(requestCount).toBe(0);
      await closeServer(server);
    });

    it('envoie le payload exact en JSON quand la variable est configurée', async () => {
      let receivedBody: string | null = null;
      let receivedContentType: string | undefined;
      const { server, url } = await startMockServer((req, res) => {
        receivedContentType = req.headers['content-type'];
        void readBody(req).then((body) => {
          receivedBody = body;
          res.writeHead(200);
          res.end();
        });
      });
      const service = await buildService(url);
      const payload = buildFeedbackWebhookPayload(feedback, user);

      service.notify(payload);
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(receivedContentType).toBe('application/json');
      expect(JSON.parse(receivedBody ?? '{}')).toEqual(payload);
      await closeServer(server);
    });

    it('journalise un avertissement générique si Make répond une erreur serveur (500), sans lever d’exception', async () => {
      const { server, url } = await startMockServer((_req, res) => {
        res.writeHead(500);
        res.end();
      });
      const service = await buildService(url);

      expect(() =>
        service.notify(buildFeedbackWebhookPayload(feedback, user)),
      ).not.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(warnSpy).toHaveBeenCalledTimes(1);
      const [message] = warnSpy.mock.calls[0] as [string];
      expect(message).not.toContain(url);
      expect(message).not.toContain(feedback.message);
      await closeServer(server);
    });

    it('abandonne au bout de ~2 s et journalise un avertissement générique si Make ne répond pas', async () => {
      const { server, url } = await startMockServer((_req, res) => {
        // Ne répond jamais avant la fermeture du serveur — simule un Make indisponible/très lent.
        setTimeout(() => {
          if (!res.writableEnded) {
            res.writeHead(200);
            res.end();
          }
        }, 4000);
      });
      const service = await buildService(url);

      const start = Date.now();
      service.notify(buildFeedbackWebhookPayload(feedback, user));

      await new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          if (warnSpy.mock.calls.length > 0) {
            clearInterval(interval);
            resolve();
          }
        }, 50);
      });
      const elapsedMs = Date.now() - start;

      expect(elapsedMs).toBeLessThan(3000);
      expect(elapsedMs).toBeGreaterThanOrEqual(1900);
      const [message] = warnSpy.mock.calls[0] as [string];
      expect(message).not.toContain(url);
      await closeServer(server);
    }, 10000);

    it('ne retourne rien (fire-and-forget) : impossible pour un appelant de l’attendre par erreur', async () => {
      const { server, url } = await startMockServer((_req, res) => {
        res.writeHead(200);
        res.end();
      });
      const service = await buildService(url);

      const result = service.notify(
        buildFeedbackWebhookPayload(feedback, user),
      );

      expect(result).toBeUndefined();
      await new Promise((resolve) => setTimeout(resolve, 200));
      await closeServer(server);
    });
  });
});
