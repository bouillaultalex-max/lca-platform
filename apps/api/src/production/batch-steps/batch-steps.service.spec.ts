import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { BatchStepsService } from './batch-steps.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BatchStatus, BatchStep } from '../../../generated/prisma/client';

describe('BatchStepsService', () => {
  let service: BatchStepsService;
  let prisma: {
    batch: {
      findFirst: jest.Mock;
      update: jest.Mock<Promise<unknown>, [Record<string, unknown>]>;
    };
  };

  const siteId = 'site-1';
  const batchId = 'batch-1';

  const baseBatch = {
    id: batchId,
    siteId,
    status: BatchStatus.PLANIFIE,
    currentStep: null as BatchStep | null,
    startedAt: null as Date | null,
  };

  beforeEach(async () => {
    prisma = {
      batch: {
        findFirst: jest.fn(),
        update: jest.fn<Promise<unknown>, [Record<string, unknown>]>(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BatchStepsService,
        { provide: PrismaService, useValue: prisma },
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
