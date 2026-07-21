import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { BatchStepsService } from './batch-steps.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BatchFeasibilityService } from '../../batching/batch-feasibility/batch-feasibility.service';
import { BatchStatus, BatchStep } from '../../../generated/prisma/client';

describe('BatchStepsService', () => {
  let service: BatchStepsService;
  let prisma: {
    batch: {
      findFirst: jest.Mock;
      update: jest.Mock<Promise<unknown>, [Record<string, unknown>]>;
    };
  };
  let batchFeasibilityService: { checkFeasibility: jest.Mock };

  const siteId = 'site-1';
  const batchId = 'batch-1';

  const baseBatch = {
    id: batchId,
    siteId,
    recipeId: 'recipe-1',
    status: BatchStatus.PLANIFIE,
    currentStep: null as BatchStep | null,
    startedAt: null as Date | null,
    plannedQuantity: 500,
    // Batch antérieur à PRD-11 par défaut (aucune allocation) — voir tests dédiés
    // ci-dessous pour les cas à une ou plusieurs allocations.
    allocations: [] as { plannedQuantity: number }[],
  };

  const feasible = {
    isFeasible: true,
    requestedQuantity: 500,
    shortages: [],
    maxFeasibleQuantity: null,
  };

  beforeEach(async () => {
    prisma = {
      batch: {
        findFirst: jest.fn(),
        update: jest.fn<Promise<unknown>, [Record<string, unknown>]>(),
      },
    };
    batchFeasibilityService = {
      checkFeasibility: jest.fn().mockResolvedValue(feasible),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BatchStepsService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: BatchFeasibilityService,
          useValue: batchFeasibilityService,
        },
      ],
    }).compile();

    service = module.get(BatchStepsService);
  });

  it('lève NotFoundException si le batch est introuvable sur ce site', async () => {
    prisma.batch.findFirst.mockResolvedValue(null);

    await expect(service.advance(siteId, batchId)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('démarre le batch à PREPARATION et passe le statut à EN_COURS quand aucune étape n’est encore définie', async () => {
    prisma.batch.findFirst.mockResolvedValue(baseBatch);
    prisma.batch.update.mockResolvedValue({});

    await service.advance(siteId, batchId);

    const updateArgs = prisma.batch.update.mock.calls[0][0] as {
      data: { currentStep: BatchStep; status: BatchStatus; startedAt: Date };
    };
    expect(updateArgs.data.currentStep).toBe(BatchStep.PREPARATION);
    expect(updateArgs.data.status).toBe(BatchStatus.EN_COURS);
    expect(updateArgs.data.startedAt).toBeInstanceOf(Date);
  });

  it('autorise le lancement d’un batch historique sans allocation (aucun backfill, comportement inchangé)', async () => {
    prisma.batch.findFirst.mockResolvedValue({ ...baseBatch, allocations: [] });
    prisma.batch.update.mockResolvedValue({});

    await service.advance(siteId, batchId);

    expect(batchFeasibilityService.checkFeasibility).toHaveBeenCalled();
    expect(prisma.batch.update).toHaveBeenCalled();
  });

  it('autorise le lancement quand la somme des allocations correspond à la quantité planifiée', async () => {
    prisma.batch.findFirst.mockResolvedValue({
      ...baseBatch,
      plannedQuantity: 500,
      allocations: [{ plannedQuantity: 300 }, { plannedQuantity: 200 }],
    });
    prisma.batch.update.mockResolvedValue({});

    await service.advance(siteId, batchId);

    expect(batchFeasibilityService.checkFeasibility).toHaveBeenCalled();
    expect(prisma.batch.update).toHaveBeenCalled();
  });

  it('bloque le lancement quand la somme des allocations diverge de la quantité planifiée, sans jamais appeler checkFeasibility', async () => {
    prisma.batch.findFirst.mockResolvedValue({
      ...baseBatch,
      plannedQuantity: 500,
      allocations: [{ plannedQuantity: 300 }, { plannedQuantity: 150 }],
    });

    await expect(service.advance(siteId, batchId)).rejects.toThrow(
      BadRequestException,
    );
    expect(batchFeasibilityService.checkFeasibility).not.toHaveBeenCalled();
    expect(prisma.batch.update).not.toHaveBeenCalled();
  });

  it('vérifie la faisabilité du batch au premier démarrage', async () => {
    prisma.batch.findFirst.mockResolvedValue(baseBatch);
    prisma.batch.update.mockResolvedValue({});

    await service.advance(siteId, batchId);

    expect(batchFeasibilityService.checkFeasibility).toHaveBeenCalledWith(
      siteId,
      batchId,
    );
  });

  it('rejette le lancement si les stocks sont insuffisants, sans écrire quoi que ce soit', async () => {
    prisma.batch.findFirst.mockResolvedValue(baseBatch);
    batchFeasibilityService.checkFeasibility.mockResolvedValue({
      isFeasible: false,
      requestedQuantity: 500,
      shortages: [
        {
          articleId: 'mp-1',
          articleName: 'Parfum lavande',
          articleReference: 'MP-LAVANDE',
          unit: 'L',
          quantityNeeded: 50,
          quantityAvailable: 30,
          quantityMissing: 20,
        },
      ],
      maxFeasibleQuantity: 300,
    });

    await expect(service.advance(siteId, batchId)).rejects.toThrow(
      'Ce batch ne peut pas être lancé car les stocks sont insuffisants.',
    );
    expect(prisma.batch.update).not.toHaveBeenCalled();
  });

  it('ne revérifie jamais la faisabilité pour les étapes suivantes (déjà EN_COURS)', async () => {
    prisma.batch.findFirst.mockResolvedValue({
      ...baseBatch,
      status: BatchStatus.EN_COURS,
      currentStep: BatchStep.PREPARATION,
      startedAt: new Date(),
    });
    prisma.batch.update.mockResolvedValue({});

    await service.advance(siteId, batchId);

    expect(batchFeasibilityService.checkFeasibility).not.toHaveBeenCalled();
  });

  it('ne réécrase pas startedAt si déjà défini au premier démarrage', async () => {
    const existingStart = new Date('2026-07-01T08:00:00.000Z');
    prisma.batch.findFirst.mockResolvedValue({
      ...baseBatch,
      startedAt: existingStart,
    });
    prisma.batch.update.mockResolvedValue({});

    await service.advance(siteId, batchId);

    const updateArgs = prisma.batch.update.mock.calls[0][0] as {
      data: { startedAt: Date };
    };
    expect(updateArgs.data.startedAt).toBe(existingStart);
  });

  it.each([
    [BatchStep.PREPARATION, BatchStep.MELANGE],
    [BatchStep.MELANGE, BatchStep.INCORPORATION_TREMIE],
    [BatchStep.INCORPORATION_TREMIE, BatchStep.CONDITIONNEMENT],
  ])(
    'fait progresser %s vers %s dans le bon ordre',
    async (current, expectedNext) => {
      prisma.batch.findFirst.mockResolvedValue({
        ...baseBatch,
        status: BatchStatus.EN_COURS,
        currentStep: current,
        startedAt: new Date(),
      });
      prisma.batch.update.mockResolvedValue({});

      await service.advance(siteId, batchId);

      expect(prisma.batch.update).toHaveBeenCalledWith({
        where: { id: batchId },
        data: { currentStep: expectedNext },
      });
    },
  );

  it('rejette toute tentative de progression au-delà de CONDITIONNEMENT (pas de clôture ici)', async () => {
    prisma.batch.findFirst.mockResolvedValue({
      ...baseBatch,
      status: BatchStatus.EN_COURS,
      currentStep: BatchStep.CONDITIONNEMENT,
    });

    await expect(service.advance(siteId, batchId)).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.batch.update).not.toHaveBeenCalled();
  });

  it.each([BatchStatus.TERMINE, BatchStatus.ANNULE])(
    'rejette la progression d’un batch au statut %s',
    async (status) => {
      prisma.batch.findFirst.mockResolvedValue({ ...baseBatch, status });

      await expect(service.advance(siteId, batchId)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.batch.update).not.toHaveBeenCalled();
    },
  );
});
