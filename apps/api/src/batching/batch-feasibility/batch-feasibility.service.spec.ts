import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  aggregatePackagingQuantities,
  BatchFeasibilityService,
} from './batch-feasibility.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BatchPreparationService } from '../batch-preparation/batch-preparation.service';
import type {
  MaterialQuantity,
  PackagingQuantity,
} from '../batch-preparation/batch-preparation.service';
import { Prisma } from '../../../generated/prisma/client';

describe('BatchFeasibilityService', () => {
  let service: BatchFeasibilityService;
  let prisma: {
    batch: { findFirst: jest.Mock };
    stockLot: { findMany: jest.Mock };
  };
  let batchPreparationService: { computeIngredientQuantities: jest.Mock };

  const siteId = 'site-1';
  const batchId = 'batch-1';
  const referenceRecipeId = 'recipe-ref';

  const materialQuantity = (
    articleId: string,
    volumeL: number,
    overrides: Partial<MaterialQuantity> = {},
  ): MaterialQuantity => ({
    kind: 'MATIERE_PREMIERE',
    articleId,
    articleName: `MP ${articleId}`,
    articleReference: `REF-${articleId}`,
    volumeL,
    massKg: null,
    ...overrides,
  });

  const packagingQuantity = (
    articleId: string,
    quantity: number,
    overrides: Partial<PackagingQuantity> = {},
  ): PackagingQuantity => ({
    kind: 'PACKAGING',
    articleId,
    articleName: `PKG ${articleId}`,
    articleReference: `REF-${articleId}`,
    quantity,
    unit: 'unité',
    ...overrides,
  });

  const lot = (id: string, remaining: number) => ({
    id,
    remainingQuantity: new Prisma.Decimal(remaining),
  });

  // Batch à une seule allocation, dont la recette et la quantité coïncident avec
  // celles du batch — le cas quasi systématique aujourd'hui (une seule sortie
  // commerciale). `overrides` permet de simuler plusieurs allocations ou aucune.
  const baseBatch = (overrides: Record<string, unknown> = {}) => ({
    id: batchId,
    siteId,
    recipeId: referenceRecipeId,
    plannedQuantity: 500,
    allocations: [
      { id: 'alloc-1', recipeId: referenceRecipeId, plannedQuantity: 500 },
    ],
    ...overrides,
  });

  beforeEach(async () => {
    prisma = {
      batch: { findFirst: jest.fn() },
      stockLot: { findMany: jest.fn() },
    };
    batchPreparationService = { computeIngredientQuantities: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BatchFeasibilityService,
        { provide: PrismaService, useValue: prisma },
        { provide: BatchPreparationService, useValue: batchPreparationService },
      ],
    }).compile();

    service = module.get(BatchFeasibilityService);
  });

  it('lève NotFoundException si le batch est introuvable sur ce site', async () => {
    prisma.batch.findFirst.mockResolvedValue(null);

    await expect(service.checkFeasibility(siteId, batchId)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('charge le batch et ses allocations en une seule requête, scopée par site', async () => {
    prisma.batch.findFirst.mockResolvedValue(baseBatch());
    batchPreparationService.computeIngredientQuantities.mockResolvedValue([]);
    prisma.stockLot.findMany.mockResolvedValue([]);

    await service.checkFeasibility(siteId, batchId);

    expect(prisma.batch.findFirst).toHaveBeenCalledWith({
      where: { id: batchId, siteId },
      include: { allocations: true },
    });
  });

  describe('non-régression — batch à une seule allocation (comportement identique à avant PRD-11)', () => {
    it('est faisable quand tous les composants ont un stock suffisant', async () => {
      prisma.batch.findFirst.mockResolvedValue(baseBatch());
      batchPreparationService.computeIngredientQuantities.mockResolvedValue([
        materialQuantity('mp-1', 50),
        packagingQuantity('pkg-1', 500),
      ]);
      prisma.stockLot.findMany.mockResolvedValue([lot('lot-1', 1000)]);

      const report = await service.checkFeasibility(siteId, batchId);

      expect(report.isFeasible).toBe(true);
      expect(report.shortages).toEqual([]);
      expect(report.maxFeasibleQuantity).toBeNull();
    });

    it('détecte un manque sur une matière première et calcule la quantité max produisible', async () => {
      // Recette pour 3600 flacons : la matière première nécessite 360 L (0.1 L/flacon),
      // mais le stock ne permet que 248 L → max = 248 / 0.1 = 2480 flacons.
      prisma.batch.findFirst.mockResolvedValue(
        baseBatch({
          plannedQuantity: 3600,
          allocations: [
            {
              id: 'alloc-1',
              recipeId: referenceRecipeId,
              plannedQuantity: 3600,
            },
          ],
        }),
      );
      batchPreparationService.computeIngredientQuantities.mockResolvedValue([
        materialQuantity('mp-1', 360),
      ]);
      prisma.stockLot.findMany.mockResolvedValue([lot('lot-1', 248)]);

      const report = await service.checkFeasibility(siteId, batchId);

      expect(report.isFeasible).toBe(false);
      expect(report.shortages).toHaveLength(1);
      expect(report.shortages[0]).toMatchObject({
        articleId: 'mp-1',
        articleReference: 'REF-mp-1',
        unit: 'L',
        quantityNeeded: 360,
        quantityAvailable: 248,
        quantityMissing: 112,
      });
      expect(report.maxFeasibleQuantity).toBe(2480);
    });

    it('détecte un manque sur un packaging (unité de l’article, pas L)', async () => {
      prisma.batch.findFirst.mockResolvedValue(
        baseBatch({
          plannedQuantity: 1000,
          allocations: [
            {
              id: 'alloc-1',
              recipeId: referenceRecipeId,
              plannedQuantity: 1000,
            },
          ],
        }),
      );
      batchPreparationService.computeIngredientQuantities.mockResolvedValue([
        packagingQuantity('flacon', 1000, { unit: 'unité' }),
      ]);
      prisma.stockLot.findMany.mockResolvedValue([lot('lot-1', 700)]);

      const report = await service.checkFeasibility(siteId, batchId);

      expect(report.isFeasible).toBe(false);
      expect(report.shortages[0]).toMatchObject({
        unit: 'unité',
        quantityNeeded: 1000,
        quantityAvailable: 700,
        quantityMissing: 300,
      });
      expect(report.maxFeasibleQuantity).toBe(700);
    });

    it('liste tous les composants manquants et retient le minimum comme quantité max (plusieurs composants insuffisants)', async () => {
      // Pour 1000 flacons : MP nécessite 100 L (dispo 80 → max 800), packaging nécessite
      // 1000 unités (dispo 950 → max 950). Le minimum (800) doit être retenu.
      prisma.batch.findFirst.mockResolvedValue(
        baseBatch({
          plannedQuantity: 1000,
          allocations: [
            {
              id: 'alloc-1',
              recipeId: referenceRecipeId,
              plannedQuantity: 1000,
            },
          ],
        }),
      );
      batchPreparationService.computeIngredientQuantities.mockResolvedValue([
        materialQuantity('mp-1', 100),
        packagingQuantity('pkg-1', 1000),
      ]);
      prisma.stockLot.findMany.mockImplementation(
        ({ where }: { where: { articleId: string } }) =>
          Promise.resolve(
            where.articleId === 'mp-1' ? [lot('l1', 80)] : [lot('l2', 950)],
          ),
      );

      const report = await service.checkFeasibility(siteId, batchId);

      expect(report.isFeasible).toBe(false);
      expect(report.shortages).toHaveLength(2);
      expect(report.maxFeasibleQuantity).toBe(800);
    });

    it('gère un stock nul (quantité max produisible = 0)', async () => {
      prisma.batch.findFirst.mockResolvedValue(
        baseBatch({
          plannedQuantity: 1000,
          allocations: [
            {
              id: 'alloc-1',
              recipeId: referenceRecipeId,
              plannedQuantity: 1000,
            },
          ],
        }),
      );
      batchPreparationService.computeIngredientQuantities.mockResolvedValue([
        materialQuantity('mp-1', 100),
      ]);
      prisma.stockLot.findMany.mockResolvedValue([]);

      const report = await service.checkFeasibility(siteId, batchId);

      expect(report.isFeasible).toBe(false);
      expect(report.shortages[0].quantityAvailable).toBe(0);
      expect(report.shortages[0].quantityMissing).toBe(100);
      expect(report.maxFeasibleQuantity).toBe(0);
    });

    it('ignore un composant à taux de consommation nul dans le calcul du max (pas de division par zéro)', async () => {
      prisma.batch.findFirst.mockResolvedValue(
        baseBatch({
          plannedQuantity: 1000,
          allocations: [
            {
              id: 'alloc-1',
              recipeId: referenceRecipeId,
              plannedQuantity: 1000,
            },
          ],
        }),
      );
      batchPreparationService.computeIngredientQuantities.mockResolvedValue([
        materialQuantity('mp-zero', 0),
        materialQuantity('mp-1', 100),
      ]);
      prisma.stockLot.findMany.mockImplementation(
        ({ where }: { where: { articleId: string } }) =>
          Promise.resolve(
            where.articleId === 'mp-1' ? [lot('l1', 50)] : [lot('l2', 0)],
          ),
      );

      const report = await service.checkFeasibility(siteId, batchId);

      expect(report.isFeasible).toBe(false);
      // Seul mp-1 est réellement limitant (500) ; mp-zero (taux nul) n'influence jamais le minimum.
      expect(report.maxFeasibleQuantity).toBe(500);
    });

    it('arrondit systématiquement la quantité max produisible vers le bas', async () => {
      // 100 flacons nécessitent 100 L (1 L/flacon) ; stock dispo = 33.7 L → max = 33 (jamais 34).
      prisma.batch.findFirst.mockResolvedValue(
        baseBatch({
          plannedQuantity: 100,
          allocations: [
            {
              id: 'alloc-1',
              recipeId: referenceRecipeId,
              plannedQuantity: 100,
            },
          ],
        }),
      );
      batchPreparationService.computeIngredientQuantities.mockResolvedValue([
        materialQuantity('mp-1', 100),
      ]);
      prisma.stockLot.findMany.mockResolvedValue([lot('lot-1', 33.7)]);

      const report = await service.checkFeasibility(siteId, batchId);

      expect(report.maxFeasibleQuantity).toBe(33);
    });

    it('additionne plusieurs lots FIFO pour un même article', async () => {
      prisma.batch.findFirst.mockResolvedValue(
        baseBatch({
          plannedQuantity: 1000,
          allocations: [
            {
              id: 'alloc-1',
              recipeId: referenceRecipeId,
              plannedQuantity: 1000,
            },
          ],
        }),
      );
      batchPreparationService.computeIngredientQuantities.mockResolvedValue([
        materialQuantity('mp-1', 100),
      ]);
      prisma.stockLot.findMany.mockResolvedValue([
        lot('l1', 20),
        lot('l2', 30),
        lot('l3', 10),
      ]);

      const report = await service.checkFeasibility(siteId, batchId);

      expect(report.shortages[0].quantityAvailable).toBe(60);
      expect(report.shortages[0].quantityMissing).toBe(40);
    });
  });

  describe('batch sans allocation (antérieur à PRD-11, aucun backfill)', () => {
    it('conserve exactement le comportement actuel, sans appel Prisma redondant', async () => {
      prisma.batch.findFirst.mockResolvedValue(baseBatch({ allocations: [] }));
      batchPreparationService.computeIngredientQuantities.mockResolvedValue([
        materialQuantity('mp-1', 50),
        packagingQuantity('pkg-1', 500),
      ]);
      prisma.stockLot.findMany.mockResolvedValue([lot('lot-1', 1000)]);

      const report = await service.checkFeasibility(siteId, batchId);

      expect(report.isFeasible).toBe(true);
      // Une seule lecture de la recette de référence, réutilisée pour la matière ET
      // le packaging : pas d'appel redondant en l'absence d'allocation.
      expect(
        batchPreparationService.computeIngredientQuantities,
      ).toHaveBeenCalledTimes(1);
      expect(
        batchPreparationService.computeIngredientQuantities,
      ).toHaveBeenCalledWith(siteId, referenceRecipeId, 500);
    });
  });

  describe('plusieurs allocations', () => {
    it('agrège le packaging de deux allocations à articles distincts', async () => {
      prisma.batch.findFirst.mockResolvedValue(
        baseBatch({
          allocations: [
            { id: 'alloc-1', recipeId: 'recipe-fr', plannedQuantity: 300 },
            { id: 'alloc-2', recipeId: 'recipe-ch', plannedQuantity: 200 },
          ],
        }),
      );
      batchPreparationService.computeIngredientQuantities.mockImplementation(
        (_siteId: string, recipeId: string) => {
          if (recipeId === referenceRecipeId) {
            return Promise.resolve([materialQuantity('mp-1', 50)]);
          }
          if (recipeId === 'recipe-fr') {
            return Promise.resolve([packagingQuantity('flacon-fr', 300)]);
          }
          return Promise.resolve([packagingQuantity('flacon-ch', 200)]);
        },
      );
      prisma.stockLot.findMany.mockResolvedValue([lot('l1', 1000)]);

      const report = await service.checkFeasibility(siteId, batchId);

      expect(report.isFeasible).toBe(true);
      expect(
        batchPreparationService.computeIngredientQuantities,
      ).toHaveBeenCalledWith(siteId, 'recipe-fr', 300);
      expect(
        batchPreparationService.computeIngredientQuantities,
      ).toHaveBeenCalledWith(siteId, 'recipe-ch', 200);
    });

    it('somme le besoin packaging d’un article partagé entre deux allocations avant comparaison au stock (pas allocation par allocation)', async () => {
      prisma.batch.findFirst.mockResolvedValue(
        baseBatch({
          allocations: [
            { id: 'alloc-1', recipeId: 'recipe-fr', plannedQuantity: 300 },
            { id: 'alloc-2', recipeId: 'recipe-ch', plannedQuantity: 200 },
          ],
        }),
      );
      batchPreparationService.computeIngredientQuantities.mockImplementation(
        (_siteId: string, recipeId: string) => {
          if (recipeId === referenceRecipeId) {
            return Promise.resolve([]);
          }
          // Les deux allocations partagent le même bouchon.
          return Promise.resolve([
            packagingQuantity('bouchon', recipeId === 'recipe-fr' ? 300 : 200),
          ]);
        },
      );
      // 450 disponibles : insuffisant pour la somme (500) mais suffisant pour chaque
      // allocation prise isolément (300 et 200) — preuve que la comparaison porte bien
      // sur la somme, pas allocation par allocation.
      prisma.stockLot.findMany.mockResolvedValue([lot('l1', 450)]);

      const report = await service.checkFeasibility(siteId, batchId);

      expect(report.isFeasible).toBe(false);
      expect(report.shortages).toHaveLength(1);
      expect(report.shortages[0]).toMatchObject({
        articleId: 'bouchon',
        quantityNeeded: 500,
        quantityAvailable: 450,
        quantityMissing: 50,
      });
    });

    it('force maxFeasibleQuantity à null dès que le batch a plusieurs allocations, même en cas de manque', async () => {
      prisma.batch.findFirst.mockResolvedValue(
        baseBatch({
          allocations: [
            { id: 'alloc-1', recipeId: 'recipe-fr', plannedQuantity: 300 },
            { id: 'alloc-2', recipeId: 'recipe-ch', plannedQuantity: 200 },
          ],
        }),
      );
      batchPreparationService.computeIngredientQuantities.mockImplementation(
        (_siteId: string, recipeId: string) =>
          Promise.resolve(
            recipeId === referenceRecipeId
              ? [materialQuantity('mp-1', 100)]
              : [],
          ),
      );
      prisma.stockLot.findMany.mockResolvedValue([lot('l1', 10)]);

      const report = await service.checkFeasibility(siteId, batchId);

      expect(report.isFeasible).toBe(false);
      expect(report.shortages.length).toBeGreaterThan(0);
      expect(report.maxFeasibleQuantity).toBeNull();
    });

    it('retourne maxFeasibleQuantity = null même quand le batch à plusieurs allocations est entièrement faisable', async () => {
      prisma.batch.findFirst.mockResolvedValue(
        baseBatch({
          allocations: [
            { id: 'alloc-1', recipeId: 'recipe-fr', plannedQuantity: 300 },
            { id: 'alloc-2', recipeId: 'recipe-ch', plannedQuantity: 200 },
          ],
        }),
      );
      batchPreparationService.computeIngredientQuantities.mockResolvedValue([]);
      prisma.stockLot.findMany.mockResolvedValue([]);

      const report = await service.checkFeasibility(siteId, batchId);

      expect(report.isFeasible).toBe(true);
      expect(report.maxFeasibleQuantity).toBeNull();
    });
  });

  describe('aggregatePackagingQuantities (fonction pure)', () => {
    it('somme les quantités d’un même article en Decimal, sans dérive', () => {
      const result = aggregatePackagingQuantities([
        [packagingQuantity('bouchon', 0.1)],
        [packagingQuantity('bouchon', 0.2)],
      ]);

      expect(result).toHaveLength(1);
      expect(result[0].articleId).toBe('bouchon');
      expect(result[0].quantity).toBe(0.3);
    });

    it('conserve les articles distincts séparément', () => {
      const result = aggregatePackagingQuantities([
        [packagingQuantity('a', 10), packagingQuantity('b', 5)],
        [packagingQuantity('a', 20)],
      ]);

      expect(result).toHaveLength(2);
      expect(result.find((r) => r.articleId === 'a')?.quantity).toBe(30);
      expect(result.find((r) => r.articleId === 'b')?.quantity).toBe(5);
    });

    it('retourne un tableau vide pour une absence de lignes', () => {
      expect(aggregatePackagingQuantities([])).toEqual([]);
      expect(aggregatePackagingQuantities([[], []])).toEqual([]);
    });

    it('conserve les métadonnées de l’article (nom, référence, unité) de la première occurrence', () => {
      const result = aggregatePackagingQuantities([
        [
          packagingQuantity('bouchon', 10, {
            articleName: 'Bouchon doseur',
            articleReference: 'PKG-BOUCHON',
            unit: 'unité',
          }),
        ],
        [packagingQuantity('bouchon', 5)],
      ]);

      expect(result[0]).toMatchObject({
        articleName: 'Bouchon doseur',
        articleReference: 'PKG-BOUCHON',
        unit: 'unité',
        quantity: 15,
      });
    });
  });
});
