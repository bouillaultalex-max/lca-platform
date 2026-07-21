import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { BatchProductAllocationsService } from './batch-product-allocations.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ArticleType,
  BatchStatus,
  BatchStep,
  Prisma,
  RecipeStatus,
} from '../../../generated/prisma/client';

describe('BatchProductAllocationsService', () => {
  let service: BatchProductAllocationsService;

  const siteId = 'site-1';
  const batchId = 'batch-1';

  const materialLine = (articleId: string, quantityPerUnit: number) => ({
    articleId,
    quantityPerUnit: new Prisma.Decimal(quantityPerUnit),
    article: { type: ArticleType.MATIERE_PREMIERE },
  });

  const runningBatch = {
    id: batchId,
    siteId,
    recipeId: 'recipe-ref',
    format: 100,
    plannedQuantity: 500,
    status: BatchStatus.PLANIFIE,
    currentStep: null as BatchStep | null,
  };

  const referenceRecipe = {
    id: 'recipe-ref',
    siteId,
    finishedProductId: 'product-standard',
    format: 100,
    status: RecipeStatus.ACTIVE,
    lines: [materialLine('article-1', 45.5), materialLine('article-2', 54.5)],
  };

  const candidateRecipe = {
    id: 'recipe-candidate',
    siteId,
    finishedProductId: 'product-suisse',
    format: 100,
    status: RecipeStatus.ACTIVE,
    lines: [materialLine('article-1', 45.5), materialLine('article-2', 54.5)],
  };

  const activeFinishedProduct = (overrides: Record<string, unknown> = {}) => ({
    id: 'product-suisse',
    siteId,
    type: ArticleType.PRODUIT_FINI,
    name: 'Recharge Lavande Suisse',
    active: true,
    productFamilyId: null,
    marketId: null,
    ...overrides,
  });

  let prisma: {
    batch: { findFirst: jest.Mock; update: jest.Mock };
    batchProductAllocation: {
      create: jest.Mock<Promise<unknown>, [Record<string, unknown>]>;
      findFirst: jest.Mock;
      findMany: jest.Mock;
    };
    article: { findUnique: jest.Mock; findFirst: jest.Mock };
    $transaction: jest.Mock<Promise<unknown>, [(tx: unknown) => unknown]>;
  };
  let tx: {
    batch: { findFirst: jest.Mock; update: jest.Mock };
    recipe: { findFirst: jest.Mock };
    article: { findUnique: jest.Mock; findFirst: jest.Mock };
    market: { findFirst: jest.Mock };
    batchProductAllocation: {
      create: jest.Mock;
      findFirst: jest.Mock;
    };
  };

  beforeEach(async () => {
    tx = {
      batch: { findFirst: jest.fn(), update: jest.fn() },
      recipe: { findFirst: jest.fn() },
      article: { findUnique: jest.fn(), findFirst: jest.fn() },
      market: { findFirst: jest.fn() },
      batchProductAllocation: { create: jest.fn(), findFirst: jest.fn() },
    };

    prisma = {
      batch: { findFirst: jest.fn(), update: jest.fn() },
      batchProductAllocation: {
        create: jest.fn<Promise<unknown>, [Record<string, unknown>]>(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
      article: { findUnique: jest.fn(), findFirst: jest.fn() },
      $transaction: jest.fn<Promise<unknown>, [(tx: unknown) => unknown]>(
        (callback) => Promise.resolve(callback(tx)),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BatchProductAllocationsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(BatchProductAllocationsService);
  });

  describe('createInitialAllocation', () => {
    it('crée une allocation sans marché quand le produit n’appartient à aucune famille', async () => {
      prisma.article.findUnique.mockResolvedValue({ marketId: null });
      prisma.batchProductAllocation.create.mockResolvedValue({ id: 'alloc-1' });

      await service.createInitialAllocation(
        { id: batchId, plannedQuantity: 500 },
        { id: 'recipe-ref', finishedProductId: 'product-standard' },
      );

      expect(prisma.batchProductAllocation.create).toHaveBeenCalledWith({
        data: {
          batchId,
          productId: 'product-standard',
          recipeId: 'recipe-ref',
          marketId: null,
          plannedQuantity: 500,
        },
      });
    });

    it('dérive automatiquement le marché du produit fini quand il en a un', async () => {
      prisma.article.findUnique.mockResolvedValue({ marketId: 'market-fr' });
      prisma.batchProductAllocation.create.mockResolvedValue({ id: 'alloc-1' });

      await service.createInitialAllocation(
        { id: batchId, plannedQuantity: 500 },
        { id: 'recipe-ref', finishedProductId: 'product-fr' },
      );

      expect(prisma.batchProductAllocation.create).toHaveBeenCalledWith({
        data: {
          batchId,
          productId: 'product-fr',
          recipeId: 'recipe-ref',
          marketId: 'market-fr',
          plannedQuantity: 500,
        },
      });
    });

    it('fonctionne avec un client transactionnel fourni explicitement (pas PrismaService)', async () => {
      const txClient = {
        article: {
          findUnique: jest.fn().mockResolvedValue({ marketId: null }),
        },
        batchProductAllocation: {
          create: jest.fn().mockResolvedValue({ id: 'alloc-1' }),
        },
      };

      await service.createInitialAllocation(
        { id: batchId, plannedQuantity: 500 },
        { id: 'recipe-ref', finishedProductId: 'product-standard' },
        txClient,
      );

      expect(txClient.batchProductAllocation.create).toHaveBeenCalled();
      expect(prisma.batchProductAllocation.create).not.toHaveBeenCalled();
    });
  });

  describe('addAllocation', () => {
    const addViaMarket = (
      overrides: Partial<{ marketId: string; plannedQuantity: number }> = {},
    ) =>
      service.addAllocation(siteId, batchId, {
        marketId: 'market-ch',
        plannedQuantity: 200,
        ...overrides,
      });

    const addViaProduct = (
      overrides: Partial<{ productId: string; plannedQuantity: number }> = {},
    ) =>
      service.addAllocation(siteId, batchId, {
        productId: 'product-suisse',
        plannedQuantity: 200,
        ...overrides,
      });

    beforeEach(() => {
      tx.batch.findFirst.mockResolvedValue(runningBatch);
      tx.recipe.findFirst.mockImplementation(
        ({ where }: { where: { id?: string; finishedProductId?: string } }) => {
          if (where.id === referenceRecipe.id) {
            return Promise.resolve(referenceRecipe);
          }
          return Promise.resolve(candidateRecipe);
        },
      );
      tx.article.findUnique.mockResolvedValue({
        productFamilyId: 'family-1',
      });
      tx.market.findFirst.mockResolvedValue({ id: 'market-ch', siteId });
      tx.article.findFirst.mockResolvedValue(activeFinishedProduct());
      tx.batchProductAllocation.findFirst.mockResolvedValue(null);
      tx.batchProductAllocation.create.mockResolvedValue({
        id: 'alloc-2',
        batchId,
        productId: 'product-suisse',
        recipeId: 'recipe-candidate',
        marketId: 'market-ch',
        plannedQuantity: 200,
      });
    });

    it('ajoute une allocation via un marché résolu automatiquement', async () => {
      const result = await addViaMarket();

      expect(result).toEqual(
        expect.objectContaining({ productId: 'product-suisse' }),
      );
      expect(tx.article.findFirst).toHaveBeenCalledWith({
        where: { siteId, productFamilyId: 'family-1', marketId: 'market-ch' },
      });
      expect(tx.batchProductAllocation.create).toHaveBeenCalledWith({
        data: {
          batchId,
          productId: 'product-suisse',
          recipeId: 'recipe-candidate',
          marketId: 'market-ch',
          plannedQuantity: 200,
        },
      });
    });

    it('ajoute une allocation via un produit direct sans famille commerciale', async () => {
      tx.article.findFirst.mockResolvedValue(
        activeFinishedProduct({ productFamilyId: null }),
      );

      const result = await addViaProduct();

      expect(result).toEqual(
        expect.objectContaining({ productId: 'product-suisse' }),
      );
      expect(tx.batchProductAllocation.create).toHaveBeenCalledWith({
        data: {
          batchId,
          productId: 'product-suisse',
          recipeId: 'recipe-candidate',
          marketId: null,
          plannedQuantity: 200,
        },
      });
    });

    it('incrémente Batch.plannedQuantity avec un increment atomique, jamais une valeur littérale', async () => {
      await addViaMarket();

      expect(tx.batch.update).toHaveBeenCalledWith({
        where: { id: batchId },
        data: { plannedQuantity: { increment: 200 } },
      });
    });

    it('rejette le chemin produit direct quand le produit appartient à une famille commerciale', async () => {
      tx.article.findFirst.mockResolvedValue(
        activeFinishedProduct({ productFamilyId: 'family-1' }),
      );

      await expect(addViaProduct()).rejects.toThrow(BadRequestException);
    });

    it('rejette un produit désactivé', async () => {
      tx.article.findFirst.mockResolvedValue(
        activeFinishedProduct({ active: false, productFamilyId: null }),
      );

      await expect(addViaProduct()).rejects.toThrow(BadRequestException);
    });

    it('rejette un article qui n’est pas de type PRODUIT_FINI', async () => {
      tx.article.findFirst.mockResolvedValue(
        activeFinishedProduct({
          type: ArticleType.PACKAGING,
          productFamilyId: null,
        }),
      );

      await expect(addViaProduct()).rejects.toThrow(BadRequestException);
    });

    it('rejette quand aucune recette active n’existe pour le produit résolu à ce format', async () => {
      tx.recipe.findFirst.mockImplementation(
        ({ where }: { where: { id?: string; finishedProductId?: string } }) => {
          if (where.id === referenceRecipe.id) {
            return Promise.resolve(referenceRecipe);
          }
          return Promise.resolve(null);
        },
      );

      await expect(addViaMarket()).rejects.toThrow(BadRequestException);
    });

    it('rejette une recette candidate dont le format diverge (FORMAT_MISMATCH)', async () => {
      tx.recipe.findFirst.mockImplementation(
        ({ where }: { where: { id?: string; finishedProductId?: string } }) => {
          if (where.id === referenceRecipe.id) {
            return Promise.resolve(referenceRecipe);
          }
          return Promise.resolve({ ...candidateRecipe, format: 200 });
        },
      );

      await expect(addViaMarket()).rejects.toThrow(BadRequestException);
      expect(tx.batchProductAllocation.create).not.toHaveBeenCalled();
    });

    it('rejette une recette candidate dont la matière première diverge (MATERIAL_MISMATCH)', async () => {
      tx.recipe.findFirst.mockImplementation(
        ({ where }: { where: { id?: string; finishedProductId?: string } }) => {
          if (where.id === referenceRecipe.id) {
            return Promise.resolve(referenceRecipe);
          }
          return Promise.resolve({
            ...candidateRecipe,
            lines: [materialLine('article-1', 45.5)],
          });
        },
      );

      await expect(addViaMarket()).rejects.toThrow(BadRequestException);
      expect(tx.batchProductAllocation.create).not.toHaveBeenCalled();
    });

    it('rejette une recette candidate dont une quantité par unité diverge (QUANTITY_MISMATCH)', async () => {
      tx.recipe.findFirst.mockImplementation(
        ({ where }: { where: { id?: string; finishedProductId?: string } }) => {
          if (where.id === referenceRecipe.id) {
            return Promise.resolve(referenceRecipe);
          }
          return Promise.resolve({
            ...candidateRecipe,
            lines: [
              materialLine('article-1', 46),
              materialLine('article-2', 54),
            ],
          });
        },
      );

      await expect(addViaMarket()).rejects.toThrow(BadRequestException);
      expect(tx.batchProductAllocation.create).not.toHaveBeenCalled();
    });

    it('rejette un doublon de produit déjà alloué dans ce batch (pré-vérification)', async () => {
      tx.batchProductAllocation.findFirst.mockResolvedValueOnce({
        id: 'existing',
      });

      await expect(addViaMarket()).rejects.toThrow(ConflictException);
    });

    it('rejette un doublon de marché déjà alloué dans ce batch (pré-vérification)', async () => {
      tx.batchProductAllocation.findFirst
        .mockResolvedValueOnce(null) // pas de doublon produit
        .mockResolvedValueOnce({ id: 'existing' }); // doublon marché

      await expect(addViaMarket()).rejects.toThrow(ConflictException);
    });

    it('convertit une violation P2002 sur (batch, produit) en ConflictException explicite', async () => {
      const prismaError = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        { code: 'P2002', clientVersion: '7.8.0' },
      );
      Object.assign(prismaError, {
        meta: {
          driverAdapterError: {
            cause: {
              originalMessage:
                'la valeur d’une clé dupliquée rompt la contrainte unique « batch_product_allocations_batch_id_product_id_key »',
            },
          },
        },
      });
      tx.batchProductAllocation.create.mockRejectedValue(prismaError);

      await expect(addViaMarket()).rejects.toThrow(ConflictException);
    });

    it('convertit une violation P2002 sur (batch, marché) en ConflictException explicite', async () => {
      const prismaError = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        { code: 'P2002', clientVersion: '7.8.0' },
      );
      Object.assign(prismaError, {
        meta: {
          driverAdapterError: {
            cause: {
              originalMessage:
                'la valeur d’une clé dupliquée rompt la contrainte unique « batch_product_allocations_batch_id_market_id_key »',
            },
          },
        },
      });
      tx.batchProductAllocation.create.mockRejectedValue(prismaError);

      await expect(addViaMarket()).rejects.toThrow(ConflictException);
    });

    it('rejette une quantité planifiée nulle ou négative sans ouvrir de transaction', async () => {
      await expect(addViaMarket({ plannedQuantity: 0 })).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejette quand ni marché ni produit ne sont précisés', async () => {
      await expect(
        service.addAllocation(siteId, batchId, { plannedQuantity: 200 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejette quand marché et produit sont précisés en même temps', async () => {
      await expect(
        service.addAllocation(siteId, batchId, {
          marketId: 'market-ch',
          productId: 'product-suisse',
          plannedQuantity: 200,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejette un marché quand le produit de référence n’appartient à aucune famille commerciale', async () => {
      tx.article.findUnique.mockResolvedValue({ productFamilyId: null });

      await expect(addViaMarket()).rejects.toThrow(BadRequestException);
    });

    it('rejette un marché introuvable sur ce site', async () => {
      tx.market.findFirst.mockResolvedValue(null);

      await expect(addViaMarket()).rejects.toThrow(NotFoundException);
    });

    it('rejette quand aucun produit n’est décliné pour ce marché dans la famille', async () => {
      tx.article.findFirst.mockResolvedValue(null);

      await expect(addViaMarket()).rejects.toThrow(BadRequestException);
    });

    it('rejette un produit direct introuvable sur ce site', async () => {
      tx.article.findFirst.mockResolvedValue(null);

      await expect(addViaProduct()).rejects.toThrow(NotFoundException);
    });

    it('rejette un batch introuvable sur ce site', async () => {
      tx.batch.findFirst.mockResolvedValue(null);

      await expect(addViaMarket()).rejects.toThrow(NotFoundException);
    });

    it.each([BatchStatus.TERMINE, BatchStatus.ANNULE])(
      'rejette un batch au statut %s, même si le conditionnement n’est pas atteint',
      async (status) => {
        tx.batch.findFirst.mockResolvedValue({
          ...runningBatch,
          status,
          currentStep: BatchStep.MELANGE,
        });

        await expect(addViaMarket()).rejects.toThrow(BadRequestException);
      },
    );

    it('rejette un batch ayant atteint le conditionnement', async () => {
      tx.batch.findFirst.mockResolvedValue({
        ...runningBatch,
        status: BatchStatus.EN_COURS,
        currentStep: BatchStep.CONDITIONNEMENT,
      });

      await expect(addViaMarket()).rejects.toThrow(BadRequestException);
    });

    it.each([
      BatchStep.PREPARATION,
      BatchStep.MELANGE,
      BatchStep.INCORPORATION_TREMIE,
      null,
    ])(
      'autorise l’ajout tant que le conditionnement n’est pas atteint (étape %s)',
      async (currentStep) => {
        tx.batch.findFirst.mockResolvedValue({
          ...runningBatch,
          status: BatchStatus.EN_COURS,
          currentStep,
        });

        await expect(addViaMarket()).resolves.toBeDefined();
      },
    );
  });

  describe('listAllocations', () => {
    it('retourne les allocations du batch, filtrées par site via le batch', async () => {
      prisma.batch.findFirst.mockResolvedValue(runningBatch);
      prisma.batchProductAllocation.findMany.mockResolvedValue([
        { id: 'alloc-1' },
      ]);

      const result = await service.listAllocations(siteId, batchId);

      expect(prisma.batch.findFirst).toHaveBeenCalledWith({
        where: { id: batchId, siteId },
      });
      expect(prisma.batchProductAllocation.findMany).toHaveBeenCalledWith({
        where: { batchId },
        orderBy: { createdAt: 'asc' },
      });
      expect(result).toEqual([{ id: 'alloc-1' }]);
    });

    it('rejette un batch introuvable sur ce site', async () => {
      prisma.batch.findFirst.mockResolvedValue(null);

      await expect(service.listAllocations(siteId, batchId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
