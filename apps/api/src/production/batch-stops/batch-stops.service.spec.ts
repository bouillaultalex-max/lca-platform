import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { BatchStopsService } from './batch-stops.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BatchStatus } from '../../../generated/prisma/client';

describe('BatchStopsService', () => {
  let service: BatchStopsService;
  let prisma: {
    batch: { findFirst: jest.Mock };
    batchStop: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };

  const siteId = 'site-1';
  const batchId = 'batch-1';

  const runningBatch = { id: batchId, siteId, status: BatchStatus.EN_COURS };

  const dto = {
    reason: 'Bourrage machine',
    startedAt: '2026-07-06T10:00:00.000Z',
  };

  beforeEach(async () => {
    prisma = {
      batch: { findFirst: jest.fn() },
      batchStop: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BatchStopsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(BatchStopsService);
  });

  describe('start', () => {
    it('lève NotFoundException si le batch est introuvable sur ce site', async () => {
      prisma.batch.findFirst.mockResolvedValue(null);

      await expect(service.start(siteId, batchId, dto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejette si le batch n’est pas en cours', async () => {
      prisma.batch.findFirst.mockResolvedValue({
        ...runningBatch,
        status: BatchStatus.PLANIFIE,
      });

      await expect(service.start(siteId, batchId, dto)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.batchStop.create).not.toHaveBeenCalled();
    });

    it('rejette si un arrêt est déjà ouvert pour ce batch', async () => {
      prisma.batch.findFirst.mockResolvedValue(runningBatch);
      prisma.batchStop.findFirst.mockResolvedValue({
        id: 'stop-existing',
        endedAt: null,
      });

      await expect(service.start(siteId, batchId, dto)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.batchStop.create).not.toHaveBeenCalled();
    });

    it('crée l’arrêt avec startedAt converti en Date et endedAt implicitement nul', async () => {
      prisma.batch.findFirst.mockResolvedValue(runningBatch);
      prisma.batchStop.findFirst.mockResolvedValue(null);
      prisma.batchStop.create.mockResolvedValue({ id: 'stop-1' });

      await service.start(siteId, batchId, dto);

      expect(prisma.batchStop.create).toHaveBeenCalledWith({
        data: {
          batchId,
          reason: dto.reason,
          startedAt: new Date(dto.startedAt),
        },
      });
    });
  });

  describe('end', () => {
    const openStop = {
      id: 'stop-1',
      batchId,
      reason: 'Bourrage machine',
      startedAt: new Date('2026-07-06T10:00:00.000Z'),
      endedAt: null as Date | null,
    };

    it('lève NotFoundException si l’arrêt est introuvable sur ce site', async () => {
      prisma.batchStop.findFirst.mockResolvedValue(null);

      await expect(
        service.end(siteId, 'stop-1', { endedAt: '2026-07-06T10:15:00.000Z' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejette un arrêt déjà clôturé', async () => {
      prisma.batchStop.findFirst.mockResolvedValue({
        ...openStop,
        endedAt: new Date(),
      });

      await expect(
        service.end(siteId, 'stop-1', { endedAt: '2026-07-06T10:15:00.000Z' }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.batchStop.update).not.toHaveBeenCalled();
    });

    it('rejette une date de fin antérieure à la date de début', async () => {
      prisma.batchStop.findFirst.mockResolvedValue(openStop);

      await expect(
        service.end(siteId, 'stop-1', { endedAt: '2026-07-06T09:00:00.000Z' }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.batchStop.update).not.toHaveBeenCalled();
    });

    it('calcule correctement la durée en minutes', async () => {
      prisma.batchStop.findFirst.mockResolvedValue(openStop);
      prisma.batchStop.update.mockResolvedValue({});

      await service.end(siteId, 'stop-1', {
        endedAt: '2026-07-06T10:45:00.000Z',
      });

      expect(prisma.batchStop.update).toHaveBeenCalledWith({
        where: { id: 'stop-1' },
        data: {
          endedAt: new Date('2026-07-06T10:45:00.000Z'),
          durationMinutes: 45,
        },
      });
    });
  });

  describe('findAllByBatch', () => {
    it('lève NotFoundException si le batch est introuvable sur ce site', async () => {
      prisma.batch.findFirst.mockResolvedValue(null);

      await expect(service.findAllByBatch(siteId, batchId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('liste les arrêts du batch, du plus récent au plus ancien', async () => {
      prisma.batch.findFirst.mockResolvedValue(runningBatch);
      prisma.batchStop.findMany.mockResolvedValue([]);

      await service.findAllByBatch(siteId, batchId);

      expect(prisma.batchStop.findMany).toHaveBeenCalledWith({
        where: { batchId },
        orderBy: { startedAt: 'desc' },
      });
    });
  });
});
