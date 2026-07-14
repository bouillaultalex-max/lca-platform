import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { RecipesService } from './recipes.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  Article,
  ArticleType,
  Prisma,
  Recipe,
  RecipeStatus,
} from '../../../generated/prisma/client';

describe('RecipesService', () => {
  let service: RecipesService;
  let prisma: {
    article: { findFirst: jest.Mock; findMany: jest.Mock };
    recipe: { findFirst: jest.Mock; findMany: jest.Mock; update: jest.Mock };
    $transaction: jest.Mock;
  };
  let tx: {
    recipe: {
      update: jest.Mock<Promise<unknown>, [Record<string, unknown>]>;
      create: jest.Mock<Promise<unknown>, [Record<string, unknown>]>;
    };
    recipeDraft: {
      deleteMany: jest.Mock<Promise<unknown>, [Record<string, unknown>]>;
    };
  };

  const siteId = 'site-1';

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

  const matierePremiere: Article = {
    id: 'mp-1',
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

  const flacon: Article = {
    id: 'pkg-1',
    siteId,
    type: ArticleType.PACKAGING,
    openSiReference: 'PKG-FLA-100',
    name: 'Flacon 100 ml',
    unitOfMeasure: 'unité',
    currentUnitCost: new Prisma.Decimal(0.35),
    active: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  const validDto = {
    finishedProductId: finishedProduct.id,
    format: 100,
    lines: [
      { articleId: matierePremiere.id, quantityPerUnit: 100, unit: '%' },
      { articleId: flacon.id, quantityPerUnit: 1, unit: 'unité' },
    ],
  };

  beforeEach(async () => {
    tx = {
      recipe: {
        update: jest.fn<Promise<unknown>, [Record<string, unknown>]>(),
        create: jest.fn<Promise<unknown>, [Record<string, unknown>]>(),
      },
      recipeDraft: {
        deleteMany: jest.fn<Promise<unknown>, [Record<string, unknown>]>(),
      },
    };
    prisma = {
      article: { findFirst: jest.fn(), findMany: jest.fn() },
      recipe: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) =>
        callback(tx),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [RecipesService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(RecipesService);
  });

  describe('create', () => {
    it('crée la version 1 quand aucune recette n’existe encore pour ce produit/format', async () => {
      prisma.article.findFirst.mockResolvedValue(finishedProduct);
      prisma.article.findMany.mockResolvedValue([matierePremiere, flacon]);
      prisma.recipe.findMany.mockResolvedValue([]);
      tx.recipe.create.mockResolvedValue({
        id: 'recipe-1',
        version: 1,
        status: RecipeStatus.ACTIVE,
      });

      const result = await service.create(siteId, validDto);

      const createArgs = tx.recipe.create.mock.calls[0][0] as {
        data: { version: number; status: RecipeStatus };
      };
      expect(tx.recipe.update).not.toHaveBeenCalled();
      expect(createArgs.data.version).toBe(1);
      expect(createArgs.data.status).toBe(RecipeStatus.ACTIVE);
      expect(result).toEqual({
        id: 'recipe-1',
        version: 1,
        status: RecipeStatus.ACTIVE,
      });
      expect(tx.recipeDraft.deleteMany).toHaveBeenCalledWith({
        where: { siteId, finishedProductId: finishedProduct.id },
      });
    });

    it('archive la version active existante et crée la version suivante', async () => {
      const previousActive: Recipe = {
        id: 'recipe-old',
        siteId,
        finishedProductId: finishedProduct.id,
        format: 100,
        version: 1,
        status: RecipeStatus.ACTIVE,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
      };

      prisma.article.findFirst.mockResolvedValue(finishedProduct);
      prisma.article.findMany.mockResolvedValue([matierePremiere, flacon]);
      prisma.recipe.findMany.mockResolvedValue([previousActive]);
      tx.recipe.create.mockResolvedValue({
        id: 'recipe-new',
        version: 2,
        status: RecipeStatus.ACTIVE,
      });

      await service.create(siteId, validDto);

      expect(tx.recipe.update).toHaveBeenCalledWith({
        where: { id: 'recipe-old' },
        data: { status: RecipeStatus.ARCHIVEE },
      });
      const createArgs = tx.recipe.create.mock.calls[0][0] as {
        data: { version: number };
      };
      expect(createArgs.data.version).toBe(2);
    });

    it('rejette si le total des pourcentages de matière première n’est pas égal à 100%', async () => {
      prisma.article.findFirst.mockResolvedValue(finishedProduct);
      prisma.article.findMany.mockResolvedValue([matierePremiere, flacon]);

      await expect(
        service.create(siteId, {
          ...validDto,
          lines: [
            { articleId: matierePremiere.id, quantityPerUnit: 90, unit: '%' },
            { articleId: flacon.id, quantityPerUnit: 1, unit: 'unité' },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejette si l’article référencé par la recette n’est pas un produit fini', async () => {
      prisma.article.findFirst.mockResolvedValue({
        ...finishedProduct,
        type: ArticleType.MATIERE_PREMIERE,
      });

      await expect(service.create(siteId, validDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejette si le produit fini est désactivé', async () => {
      prisma.article.findFirst.mockResolvedValue({
        ...finishedProduct,
        active: false,
      });

      await expect(service.create(siteId, validDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejette si un article de la recette est désactivé', async () => {
      prisma.article.findFirst.mockResolvedValue(finishedProduct);
      prisma.article.findMany.mockResolvedValue([
        { ...matierePremiere, active: false },
        flacon,
      ]);

      await expect(service.create(siteId, validDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejette les doublons d’article au sein des lignes', async () => {
      prisma.article.findFirst.mockResolvedValue(finishedProduct);

      await expect(
        service.create(siteId, {
          ...validDto,
          lines: [
            { articleId: matierePremiere.id, quantityPerUnit: 50, unit: '%' },
            { articleId: matierePremiere.id, quantityPerUnit: 50, unit: '%' },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.article.findMany).not.toHaveBeenCalled();
    });

    it('rejette si une ligne référence un produit fini', async () => {
      prisma.article.findFirst.mockResolvedValue(finishedProduct);
      prisma.article.findMany.mockResolvedValue([
        { ...flacon, type: ArticleType.PRODUIT_FINI },
      ]);

      await expect(
        service.create(siteId, {
          ...validDto,
          lines: [{ articleId: flacon.id, quantityPerUnit: 100, unit: '%' }],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findOne', () => {
    it('lève NotFoundException si la recette est introuvable sur ce site', async () => {
      prisma.recipe.findFirst.mockResolvedValue(null);

      await expect(service.findOne(siteId, 'inconnue')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('archive', () => {
    it('passe le statut de la recette à ARCHIVEE', async () => {
      const recipe = {
        id: 'recipe-1',
        siteId,
        status: RecipeStatus.ACTIVE,
        lines: [],
      };
      prisma.recipe.findFirst.mockResolvedValue(recipe);
      prisma.recipe.update.mockResolvedValue({
        ...recipe,
        status: RecipeStatus.ARCHIVEE,
      });

      const result = await service.archive(siteId, recipe.id);

      expect(prisma.recipe.update).toHaveBeenCalledWith({
        where: { id: recipe.id },
        data: { status: RecipeStatus.ARCHIVEE },
      });
      expect(result.status).toBe(RecipeStatus.ARCHIVEE);
    });
  });
});
