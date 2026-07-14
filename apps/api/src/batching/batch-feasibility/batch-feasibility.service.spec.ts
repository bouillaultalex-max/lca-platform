import { Test, TestingModule } from '@nestjs/testing';
import { BatchFeasibilityService } from './batch-feasibility.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BatchPreparationService } from '../batch-preparation/batch-preparation.service';
import type {
  MaterialQuantity,
  PackagingQuantity,
} from '../batch-preparation/batch-preparation.service';
import { Prisma } from '../../../generated/prisma/client';

describe('BatchFeasibilityService', () => {
  let service: BatchFeasibilityService;
  let prisma: { stockLot: { findMany: jest.Mock } };
  let batchPreparationService: { computeIngredientQuantities: jest.Mock };

  const siteId = 'site-1';
  const recipeId = 'recipe-1';

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

  beforeEach(async () => {
    prisma = { stockLot: { findMany: jest.fn() } };
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

  it('est faisable quand tous les composants ont un stock suffisant', async () => {
    batchPreparationService.computeIngredientQuantities.mockResolvedValue([
      materialQuantity('mp-1', 50),
      packagingQuantity('pkg-1', 500),
    ]);
    prisma.stockLot.findMany.mockResolvedValue([lot('lot-1', 1000)]);

    const report = await service.checkFeasibility(siteId, recipeId, 500);

    expect(report.isFeasible).toBe(true);
    expect(report.shortages).toEqual([]);
    expect(report.maxFeasibleQuantity).toBeNull();
  });

  it('détecte un manque sur une matière première et calcule la quantité max produisible', async () => {
    // Recette pour 3600 flacons : la matière première nécessite 360 L (0.1 L/flacon),
    // mais le stock ne permet que 248 L → max = 248 / 0.1 = 2480 flacons.
    batchPreparationService.computeIngredientQuantities.mockResolvedValue([
      materialQuantity('mp-1', 360),
    ]);
    prisma.stockLot.findMany.mockResolvedValue([lot('lot-1', 248)]);

    const report = await service.checkFeasibility(siteId, recipeId, 3600);

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
    batchPreparationService.computeIngredientQuantities.mockResolvedValue([
      packagingQuantity('flacon', 1000, { unit: 'unité' }),
    ]);
    prisma.stockLot.findMany.mockResolvedValue([lot('lot-1', 700)]);

    const report = await service.checkFeasibility(siteId, recipeId, 1000);

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

    const report = await service.checkFeasibility(siteId, recipeId, 1000);

    expect(report.isFeasible).toBe(false);
    expect(report.shortages).toHaveLength(2);
    expect(report.maxFeasibleQuantity).toBe(800);
  });

  it('gère un stock nul (quantité max produisible = 0)', async () => {
    batchPreparationService.computeIngredientQuantities.mockResolvedValue([
      materialQuantity('mp-1', 100),
    ]);
    prisma.stockLot.findMany.mockResolvedValue([]);

    const report = await service.checkFeasibility(siteId, recipeId, 1000);

    expect(report.isFeasible).toBe(false);
    expect(report.shortages[0].quantityAvailable).toBe(0);
    expect(report.shortages[0].quantityMissing).toBe(100);
    expect(report.maxFeasibleQuantity).toBe(0);
  });

  it('ignore un composant à taux de consommation nul dans le calcul du max (pas de division par zéro)', async () => {
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

    const report = await service.checkFeasibility(siteId, recipeId, 1000);

    expect(report.isFeasible).toBe(false);
    // Seul mp-1 est réellement limitant (500) ; mp-zero (taux nul) n'influence jamais le minimum.
    expect(report.maxFeasibleQuantity).toBe(500);
  });

  it('arrondit systématiquement la quantité max produisible vers le bas', async () => {
    // 100 flacons nécessitent 100 L (1 L/flacon) ; stock dispo = 33.7 L → max = 33 (jamais 34).
    batchPreparationService.computeIngredientQuantities.mockResolvedValue([
      materialQuantity('mp-1', 100),
    ]);
    prisma.stockLot.findMany.mockResolvedValue([lot('lot-1', 33.7)]);

    const report = await service.checkFeasibility(siteId, recipeId, 100);

    expect(report.maxFeasibleQuantity).toBe(33);
  });

  it('additionne plusieurs lots FIFO pour un même article', async () => {
    batchPreparationService.computeIngredientQuantities.mockResolvedValue([
      materialQuantity('mp-1', 100),
    ]);
    prisma.stockLot.findMany.mockResolvedValue([
      lot('l1', 20),
      lot('l2', 30),
      lot('l3', 10),
    ]);

    const report = await service.checkFeasibility(siteId, recipeId, 1000);

    expect(report.shortages[0].quantityAvailable).toBe(60);
    expect(report.shortages[0].quantityMissing).toBe(40);
  });
});
