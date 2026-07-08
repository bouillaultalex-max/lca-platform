import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ArticlesService } from './articles.service';
import { PrismaService } from '../../prisma/prisma.service';
import { Article, ArticleType, Prisma } from '../../../generated/prisma/client';

describe('ArticlesService', () => {
  let service: ArticlesService;
  let prisma: {
    article: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };

  const siteId = 'site-1';

  const article: Article = {
    id: 'article-1',
    siteId,
    type: ArticleType.MATIERE_PREMIERE,
    openSiReference: 'MP-LAVANDE',
    name: 'Parfum ambiance lavande (vrac)',
    unitOfMeasure: 'L',
    currentUnitCost: new Prisma.Decimal(12.5),
    active: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  beforeEach(async () => {
    prisma = {
      article: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ArticlesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(ArticlesService);
  });

  describe('findAll', () => {
    it('filtre par site et par type quand un type est fourni', async () => {
      prisma.article.findMany.mockResolvedValue([article]);

      const result = await service.findAll(
        siteId,
        ArticleType.MATIERE_PREMIERE,
      );

      expect(prisma.article.findMany).toHaveBeenCalledWith({
        where: { siteId, type: ArticleType.MATIERE_PREMIERE },
        orderBy: { name: 'asc' },
      });
      expect(result).toEqual([article]);
    });

    it('ne filtre que par site quand aucun type n’est fourni', async () => {
      prisma.article.findMany.mockResolvedValue([article]);

      await service.findAll(siteId);

      expect(prisma.article.findMany).toHaveBeenCalledWith({
        where: { siteId },
        orderBy: { name: 'asc' },
      });
    });
  });

  describe('findOne', () => {
    it('retourne l’article s’il existe sur ce site', async () => {
      prisma.article.findFirst.mockResolvedValue(article);

      const result = await service.findOne(siteId, article.id);

      expect(result).toEqual(article);
    });

    it('lève NotFoundException si l’article est introuvable sur ce site', async () => {
      prisma.article.findFirst.mockResolvedValue(null);

      await expect(service.findOne(siteId, 'inconnu')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('crée l’article rattaché au site courant', async () => {
      prisma.article.create.mockResolvedValue(article);

      const dto = {
        type: ArticleType.MATIERE_PREMIERE,
        openSiReference: 'MP-LAVANDE',
        name: 'Parfum ambiance lavande (vrac)',
        unitOfMeasure: 'L',
        currentUnitCost: 12.5,
      };

      const result = await service.create(siteId, dto);

      expect(prisma.article.create).toHaveBeenCalledWith({
        data: { siteId, ...dto },
      });
      expect(result).toEqual(article);
    });

    it('convertit une violation d’unicité (référence OpenSi déjà utilisée) en ConflictException', async () => {
      prisma.article.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '7.8.0',
        }),
      );

      await expect(
        service.create(siteId, {
          type: ArticleType.MATIERE_PREMIERE,
          openSiReference: 'MP-LAVANDE',
          name: 'Doublon',
          unitOfMeasure: 'L',
          currentUnitCost: 1,
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    const zeroUsage = {
      _count: {
        recipeLines: 0,
        recipesAsFinishedProduct: 0,
        stockLots: 0,
        stockMovements: 0,
        genealogyLines: 0,
      },
    };

    it('modifie un article sans vérifier l’usage si le type n’est pas fourni', async () => {
      prisma.article.findFirst.mockResolvedValue(article);
      prisma.article.update.mockResolvedValue({
        ...article,
        name: 'Nouveau nom',
      });

      const result = await service.update(siteId, article.id, {
        name: 'Nouveau nom',
      });

      expect(prisma.article.findUnique).not.toHaveBeenCalled();
      expect(result.name).toBe('Nouveau nom');
    });

    it('modifie un article sans vérifier l’usage si le type fourni est identique à l’existant', async () => {
      prisma.article.findFirst.mockResolvedValue(article);
      prisma.article.update.mockResolvedValue(article);

      await service.update(siteId, article.id, {
        type: article.type,
        name: article.name,
      });

      expect(prisma.article.findUnique).not.toHaveBeenCalled();
    });

    it('autorise le changement de type si l’article n’a jamais été utilisé', async () => {
      prisma.article.findFirst.mockResolvedValue(article);
      prisma.article.findUnique.mockResolvedValue(zeroUsage);
      prisma.article.update.mockResolvedValue({
        ...article,
        type: ArticleType.PACKAGING,
      });

      const result = await service.update(siteId, article.id, {
        type: ArticleType.PACKAGING,
      });

      expect(result.type).toBe(ArticleType.PACKAGING);
    });

    it.each([
      ['recipeLines', { ...zeroUsage._count, recipeLines: 1 }],
      [
        'recipesAsFinishedProduct',
        { ...zeroUsage._count, recipesAsFinishedProduct: 1 },
      ],
      ['stockLots', { ...zeroUsage._count, stockLots: 1 }],
      ['stockMovements', { ...zeroUsage._count, stockMovements: 1 }],
      ['genealogyLines', { ...zeroUsage._count, genealogyLines: 1 }],
    ])('refuse le changement de type si %s > 0', async (_label, counts) => {
      prisma.article.findFirst.mockResolvedValue(article);
      prisma.article.findUnique.mockResolvedValue({ _count: counts });

      await expect(
        service.update(siteId, article.id, { type: ArticleType.PACKAGING }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.article.update).not.toHaveBeenCalled();
    });

    it('lève NotFoundException si l’article à modifier n’existe pas sur ce site', async () => {
      prisma.article.findFirst.mockResolvedValue(null);

      await expect(
        service.update(siteId, 'inconnu', { name: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deactivate', () => {
    it('désactive l’article (active: false) sans le supprimer', async () => {
      prisma.article.findFirst.mockResolvedValue(article);
      prisma.article.update.mockResolvedValue({ ...article, active: false });

      const result = await service.deactivate(siteId, article.id);

      expect(prisma.article.update).toHaveBeenCalledWith({
        where: { id: article.id },
        data: { active: false },
      });
      expect(result.active).toBe(false);
    });

    it('lève NotFoundException si l’article à désactiver n’existe pas sur ce site', async () => {
      prisma.article.findFirst.mockResolvedValue(null);

      await expect(service.deactivate(siteId, 'inconnu')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
