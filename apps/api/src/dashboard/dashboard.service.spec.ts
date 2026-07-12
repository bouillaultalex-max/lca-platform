import { Test, TestingModule } from '@nestjs/testing';
import { DashboardService } from './dashboard.service';
import { PrismaService } from '../prisma/prisma.service';

describe('DashboardService', () => {
  let service: DashboardService;
  let prisma: {
    article: { count: jest.Mock<Promise<number>, [Record<string, unknown>]> };
    recipe: { count: jest.Mock<Promise<number>, [Record<string, unknown>]> };
    machine: { count: jest.Mock<Promise<number>, [Record<string, unknown>]> };
    stockLot: { count: jest.Mock<Promise<number>, [Record<string, unknown>]> };
    batch: { count: jest.Mock<Promise<number>, [Record<string, unknown>]> };
    feedback: { count: jest.Mock<Promise<number>, [Record<string, unknown>]> };
    expectedRequirement: {
      count: jest.Mock<Promise<number>, [Record<string, unknown>]>;
    };
  };

  const siteId = 'site-1';

  beforeEach(async () => {
    prisma = {
      article: { count: jest.fn<Promise<number>, [Record<string, unknown>]>() },
      recipe: { count: jest.fn<Promise<number>, [Record<string, unknown>]>() },
      machine: { count: jest.fn<Promise<number>, [Record<string, unknown>]>() },
      stockLot: {
        count: jest.fn<Promise<number>, [Record<string, unknown>]>(),
      },
      batch: { count: jest.fn<Promise<number>, [Record<string, unknown>]>() },
      feedback: {
        count: jest.fn<Promise<number>, [Record<string, unknown>]>(),
      },
      expectedRequirement: {
        count: jest.fn<Promise<number>, [Record<string, unknown>]>(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(DashboardService);
  });

  it('agrège les 7 compteurs scopés au site courant, avec les bons filtres', async () => {
    prisma.article.count.mockResolvedValue(12);
    prisma.recipe.count.mockResolvedValue(5);
    prisma.machine.count.mockResolvedValue(2);
    prisma.stockLot.count.mockResolvedValue(30);
    prisma.batch.count.mockResolvedValue(3);
    prisma.feedback.count.mockResolvedValue(4);
    prisma.expectedRequirement.count.mockResolvedValue(20);

    const result = await service.getSummary(siteId);

    expect(prisma.article.count).toHaveBeenCalledWith({
      where: { siteId, active: true },
    });
    expect(prisma.recipe.count).toHaveBeenCalledWith({
      where: { siteId, status: 'ACTIVE' },
    });
    expect(prisma.machine.count).toHaveBeenCalledWith({
      where: { siteId, active: true },
    });
    expect(prisma.stockLot.count).toHaveBeenCalledWith({
      where: { siteId, remainingQuantity: { gt: 0 } },
    });
    expect(prisma.batch.count).toHaveBeenCalledWith({
      where: { siteId, status: { in: ['PLANIFIE', 'EN_COURS'] } },
    });
    expect(prisma.feedback.count).toHaveBeenCalledWith({
      where: { siteId, status: 'NOUVEAU' },
    });
    expect(prisma.expectedRequirement.count).toHaveBeenCalledWith({
      where: { siteId },
    });

    expect(result).toEqual({
      articlesCount: 12,
      activeRecipesCount: 5,
      activeMachinesCount: 2,
      stockLotsCount: 30,
      openBatchesCount: 3,
      unresolvedFeedbackCount: 4,
      pendingExpectedRequirementsCount: 20,
    });
  });

  it('retourne des zéros si tous les compteurs sont vides (site neuf)', async () => {
    prisma.article.count.mockResolvedValue(0);
    prisma.recipe.count.mockResolvedValue(0);
    prisma.machine.count.mockResolvedValue(0);
    prisma.stockLot.count.mockResolvedValue(0);
    prisma.batch.count.mockResolvedValue(0);
    prisma.feedback.count.mockResolvedValue(0);
    prisma.expectedRequirement.count.mockResolvedValue(0);

    const result = await service.getSummary(siteId);

    expect(Object.values(result).every((count) => count === 0)).toBe(true);
  });
});
