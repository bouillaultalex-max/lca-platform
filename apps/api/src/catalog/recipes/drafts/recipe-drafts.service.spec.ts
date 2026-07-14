import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { RecipeDraftsService } from './recipe-drafts.service';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  Article,
  ArticleType,
  Prisma,
} from '../../../../generated/prisma/client';

describe('RecipeDraftsService', () => {
  let service: RecipeDraftsService;
  let prisma: {
    article: { findFirst: jest.Mock };
    recipeDraft: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      upsert: jest.Mock<Promise<unknown>, [Record<string, unknown>]>;
      delete: jest.Mock;
    };
  };

  const siteId = 'site-1';
  const userId = 'user-1';

  const finishedProduct: Article = {
    id: 'product-1',
    siteId,
    type: ArticleType.PRODUIT_FINI,
    openSiReference: 'PF-LAV-100',
    name: 'Recharge Lavande 100 ml',
    unitOfMeasure: 'unité',
    currentUnitCost: new Prisma.Decimal(0),
    active: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  const validDto = {
    finishedProductId: finishedProduct.id,
    format: 100,
    lines: [{ articleId: 'mp-1', quantityPerUnit: '45', unit: '%' }],
  };

  beforeEach(async () => {
    prisma = {
      article: { findFirst: jest.fn() },
      recipeDraft: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        upsert: jest.fn<Promise<unknown>, [Record<string, unknown>]>(),
        delete: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecipeDraftsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(RecipeDraftsService);
  });

  describe('findForProduct', () => {
    it('retourne null quand aucun brouillon n’existe (état normal, pas une erreur)', async () => {
      prisma.recipeDraft.findUnique.mockResolvedValue(null);

      const result = await service.findForProduct(userId, finishedProduct.id);

      expect(result).toBeNull();
      expect(prisma.recipeDraft.findUnique).toHaveBeenCalledWith({
        where: {
          userId_finishedProductId: {
            userId,
            finishedProductId: finishedProduct.id,
          },
        },
      });
    });
  });

  describe('upsert', () => {
    it('rejette si le produit fini est introuvable sur ce site', async () => {
      prisma.article.findFirst.mockResolvedValue(null);

      await expect(service.upsert(siteId, userId, validDto)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.recipeDraft.upsert).not.toHaveBeenCalled();
    });

    it('crée le brouillon quand aucun n’existe encore', async () => {
      prisma.article.findFirst.mockResolvedValue(finishedProduct);
      prisma.recipeDraft.findUnique.mockResolvedValue(null);
      prisma.recipeDraft.upsert.mockResolvedValue({
        id: 'draft-1',
        content: { format: 100, lines: validDto.lines },
      });

      await service.upsert(siteId, userId, validDto);

      expect(prisma.recipeDraft.upsert).toHaveBeenCalledWith({
        where: {
          userId_finishedProductId: {
            userId,
            finishedProductId: finishedProduct.id,
          },
        },
        create: {
          siteId,
          userId,
          finishedProductId: finishedProduct.id,
          content: { format: 100, lines: validDto.lines },
        },
        update: { content: { format: 100, lines: validDto.lines } },
      });
    });

    it('met à jour le brouillon existant sans conflit détecté', async () => {
      const existing = {
        id: 'draft-1',
        updatedAt: new Date('2026-07-14T10:00:00.000Z'),
      };
      prisma.article.findFirst.mockResolvedValue(finishedProduct);
      prisma.recipeDraft.findUnique.mockResolvedValue(existing);
      prisma.recipeDraft.upsert.mockResolvedValue({ ...existing, content: {} });

      await service.upsert(siteId, userId, {
        ...validDto,
        expectedUpdatedAt: existing.updatedAt.toISOString(),
      });

      expect(prisma.recipeDraft.upsert).toHaveBeenCalled();
    });

    it('lève ConflictException si expectedUpdatedAt ne correspond plus au brouillon actuel', async () => {
      const existing = {
        id: 'draft-1',
        updatedAt: new Date('2026-07-14T10:05:00.000Z'),
      };
      prisma.article.findFirst.mockResolvedValue(finishedProduct);
      prisma.recipeDraft.findUnique.mockResolvedValue(existing);

      await expect(
        service.upsert(siteId, userId, {
          ...validDto,
          expectedUpdatedAt: '2026-07-14T10:00:00.000Z',
        }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.recipeDraft.upsert).not.toHaveBeenCalled();
    });

    it('ignore le conflit quand force=true, même avec un expectedUpdatedAt périmé', async () => {
      const existing = {
        id: 'draft-1',
        updatedAt: new Date('2026-07-14T10:05:00.000Z'),
      };
      prisma.article.findFirst.mockResolvedValue(finishedProduct);
      prisma.recipeDraft.findUnique.mockResolvedValue(existing);
      prisma.recipeDraft.upsert.mockResolvedValue({ ...existing, content: {} });

      await service.upsert(siteId, userId, {
        ...validDto,
        expectedUpdatedAt: '2026-07-14T10:00:00.000Z',
        force: true,
      });

      expect(prisma.recipeDraft.upsert).toHaveBeenCalled();
    });

    it('accepte des lignes partielles/invalides sans les rejeter (aucune validation métier sur un brouillon)', async () => {
      prisma.article.findFirst.mockResolvedValue(finishedProduct);
      prisma.recipeDraft.findUnique.mockResolvedValue(null);
      prisma.recipeDraft.upsert.mockResolvedValue({
        id: 'draft-1',
        content: {},
      });

      await service.upsert(siteId, userId, {
        finishedProductId: finishedProduct.id,
        format: null,
        lines: [{ articleId: '', quantityPerUnit: '', unit: '' }, {}],
      });

      const upsertArgs = prisma.recipeDraft.upsert.mock.calls[0][0] as {
        create: { content: { format: number | null; lines: unknown[] } };
      };
      expect(upsertArgs.create.content.format).toBeNull();
      expect(upsertArgs.create.content.lines).toEqual([
        { articleId: '', quantityPerUnit: '', unit: '' },
        { articleId: null, quantityPerUnit: null, unit: null },
      ]);
    });
  });

  describe('remove', () => {
    it('supprime un brouillon appartenant à l’utilisateur courant', async () => {
      prisma.recipeDraft.findFirst.mockResolvedValue({ id: 'draft-1', userId });
      prisma.recipeDraft.delete.mockResolvedValue({ id: 'draft-1' });

      await service.remove(userId, 'draft-1');

      expect(prisma.recipeDraft.findFirst).toHaveBeenCalledWith({
        where: { id: 'draft-1', userId },
      });
      expect(prisma.recipeDraft.delete).toHaveBeenCalledWith({
        where: { id: 'draft-1' },
      });
    });

    it('lève NotFoundException si le brouillon n’existe pas ou appartient à un autre utilisateur', async () => {
      prisma.recipeDraft.findFirst.mockResolvedValue(null);

      await expect(
        service.remove(userId, 'draft-autre-utilisateur'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.recipeDraft.delete).not.toHaveBeenCalled();
    });
  });
});
