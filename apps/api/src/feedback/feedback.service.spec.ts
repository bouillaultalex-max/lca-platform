import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { FeedbackService } from './feedback.service';
import { FeedbackWebhookService } from './feedback-webhook.service';
import { PrismaService } from '../prisma/prisma.service';
import { APP_VERSION } from '../app-version';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import {
  Feedback,
  FeedbackPriority,
  FeedbackType,
  UserRole,
} from '../../generated/prisma/client';

describe('FeedbackService', () => {
  let service: FeedbackService;
  let prisma: {
    feedback: {
      create: jest.Mock<Promise<unknown>, [Record<string, unknown>]>;
      findMany: jest.Mock<Promise<unknown>, [Record<string, unknown>]>;
      findFirst: jest.Mock<Promise<unknown>, [Record<string, unknown>]>;
      update: jest.Mock<Promise<unknown>, [Record<string, unknown>]>;
    };
  };
  let feedbackWebhookService: { notify: jest.Mock };

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

  const feedback: Feedback = {
    id: 'feedback-1',
    siteId,
    userId,
    type: FeedbackType.BUG,
    priority: FeedbackPriority.NORMALE,
    message: 'Le bouton ne répond pas.',
    pageUrl: '/catalog',
    appVersion: APP_VERSION,
    status: 'NOUVEAU',
    createdAt: new Date('2026-01-01'),
  };

  beforeEach(async () => {
    prisma = {
      feedback: {
        create: jest.fn<Promise<unknown>, [Record<string, unknown>]>(),
        findMany: jest.fn<Promise<unknown>, [Record<string, unknown>]>(),
        findFirst: jest.fn<Promise<unknown>, [Record<string, unknown>]>(),
        update: jest.fn<Promise<unknown>, [Record<string, unknown>]>(),
      },
    };
    feedbackWebhookService = { notify: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeedbackService,
        { provide: PrismaService, useValue: prisma },
        { provide: FeedbackWebhookService, useValue: feedbackWebhookService },
      ],
    }).compile();

    service = module.get(FeedbackService);
  });

  describe('create', () => {
    it("enregistre le retour avec siteId/userId dérivés de l'utilisateur courant et la version applicative figée", async () => {
      prisma.feedback.create.mockResolvedValue(feedback);

      const result = await service.create(siteId, user, {
        type: FeedbackType.BUG,
        priority: FeedbackPriority.IMPORTANTE,
        message: 'Le bouton ne répond pas.',
        pageUrl: '/catalog',
      });

      const createCallArgs = prisma.feedback.create.mock.calls[0][0];
      expect(createCallArgs).toMatchObject({
        data: {
          siteId,
          userId,
          type: FeedbackType.BUG,
          priority: FeedbackPriority.IMPORTANTE,
          message: 'Le bouton ne répond pas.',
          pageUrl: '/catalog',
          appVersion: APP_VERSION,
        },
      });
      expect(result).toEqual(feedback);
    });

    it('laisse Prisma appliquer la priorité par défaut (NORMALE) si elle est absente du payload', async () => {
      prisma.feedback.create.mockResolvedValue(feedback);

      await service.create(siteId, user, {
        type: FeedbackType.IDEE,
        message: 'Une idée.',
        pageUrl: '/stock',
      });

      const createCallArgs = prisma.feedback.create.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(createCallArgs.data.priority).toBeUndefined();
    });

    it('notifie le webhook Make avec le payload construit après succès de la création', async () => {
      prisma.feedback.create.mockResolvedValue(feedback);

      await service.create(siteId, user, {
        type: FeedbackType.BUG,
        message: 'Le bouton ne répond pas.',
        pageUrl: '/catalog',
      });

      expect(feedbackWebhookService.notify).toHaveBeenCalledTimes(1);
      expect(feedbackWebhookService.notify).toHaveBeenCalledWith({
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

    it("n'appelle jamais le webhook Make si la création en base échoue", async () => {
      prisma.feedback.create.mockRejectedValue(
        new BadRequestException('échec'),
      );

      await expect(
        service.create(siteId, user, {
          type: FeedbackType.BUG,
          message: 'Le bouton ne répond pas.',
          pageUrl: '/catalog',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(feedbackWebhookService.notify).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it("liste les retours du site, du plus récent au plus ancien, avec l'auteur", async () => {
      prisma.feedback.findMany.mockResolvedValue([feedback]);

      const result = await service.findAll(siteId);

      expect(prisma.feedback.findMany).toHaveBeenCalledWith({
        where: { siteId },
        include: { user: { select: { id: true, fullName: true } } },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual([feedback]);
    });
  });

  describe('markAsTreated', () => {
    it('bascule le statut vers TRAITE', async () => {
      prisma.feedback.findFirst.mockResolvedValue(feedback);
      prisma.feedback.update.mockResolvedValue({
        ...feedback,
        status: 'TRAITE',
      });

      const result = await service.markAsTreated(siteId, feedback.id);

      expect(prisma.feedback.update).toHaveBeenCalledWith({
        where: { id: feedback.id },
        data: { status: 'TRAITE' },
      });
      expect(result.status).toBe('TRAITE');
    });

    it("lève NotFoundException si le retour n'existe pas sur ce site", async () => {
      prisma.feedback.findFirst.mockResolvedValue(null);

      await expect(service.markAsTreated(siteId, 'inconnu')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.feedback.update).not.toHaveBeenCalled();
    });
  });
});
