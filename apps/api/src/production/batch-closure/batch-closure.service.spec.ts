import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { BatchClosureService } from './batch-closure.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BatchPreparationService } from '../../batching/batch-preparation/batch-preparation.service';
import { LotNumberGeneratorService } from '../lot-number-generator/lot-number-generator.service';
import {
  BatchStatus,
  BatchStep,
  Prisma,
  StockMovementType,
} from '../../../generated/prisma/client';

describe('BatchClosureService', () => {
  let service: BatchClosureService;

  let prisma: {
    batch: { findFirst: jest.Mock };
    batchStop: { findFirst: jest.Mock };
    $transaction: jest.Mock<Promise<unknown>, [(tx: unknown) => unknown]>;
  };
  let batchPreparationService: { computeIngredientQuantities: jest.Mock };
  let lotNumberGeneratorService: { generate: jest.Mock };
  let tx: {
    stockLot: {
      findMany: jest.Mock;
      update: jest.Mock<Promise<unknown>, [Record<string, unknown>]>;
    };
    stockItem: {
      update: jest.Mock<Promise<unknown>, [Record<string, unknown>]>;
    };
    stockMovement: {
      create: jest.Mock<Promise<unknown>, [Record<string, unknown>]>;
    };
    lotGenealogy: {
      create: jest.Mock<Promise<unknown>, [Record<string, unknown>]>;
    };
    lot: { create: jest.Mock<Promise<unknown>, [Record<string, unknown>]> };
    batch: { update: jest.Mock<Promise<unknown>, [Record<string, unknown>]> };
  };

  const siteId = 'site-1';
  const userId = 'user-1';
  const batchId = 'batch-1';

  const runningBatch = {
    id: batchId,
    siteId,
    recipeId: 'recipe-1',
    status: BatchStatus.EN_COURS,
    currentStep: BatchStep.CONDITIONNEMENT,
  };

  const dto = {
    producedQuantity: 480,
    rejectedQuantity: 20,
    endedAt: '2026-07-06T16:00:00.000Z',
  };

  const stockLot = (id: string, remaining: number) => ({
    id,
    remainingQuantity: new Prisma.Decimal(remaining),
  });

  beforeEach(async () => {
    tx = {
      stockLot: {
        findMany: jest.fn(),
        update: jest.fn<Promise<unknown>, [Record<string, unknown>]>(),
      },
      stockItem: {
        update: jest.fn<Promise<unknown>, [Record<string, unknown>]>(),
      },
      stockMovement: {
        create: jest.fn<Promise<unknown>, [Record<string, unknown>]>(),
      },
      lotGenealogy: {
        create: jest.fn<Promise<unknown>, [Record<string, unknown>]>(),
      },
      lot: { create: jest.fn<Promise<unknown>, [Record<string, unknown>]>() },
      batch: { update: jest.fn<Promise<unknown>, [Record<string, unknown>]>() },
    };

    prisma = {
      batch: { findFirst: jest.fn() },
      batchStop: { findFirst: jest.fn() },
      $transaction: jest.fn<Promise<unknown>, [(tx: unknown) => unknown]>(
        (callback) => Promise.resolve(callback(tx)),
      ),
    };

    batchPreparationService = { computeIngredientQuantities: jest.fn() };
    lotNumberGeneratorService = { generate: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BatchClosureService,
        { provide: PrismaService, useValue: prisma },
        { provide: BatchPreparationService, useValue: batchPreparationService },
        {
          provide: LotNumberGeneratorService,
          useValue: lotNumberGeneratorService,
        },
      ],
    }).compile();

    service = module.get(BatchClosureService);
  });

  it('lève NotFoundException si le batch est introuvable sur ce site', async () => {
    prisma.batch.findFirst.mockResolvedValue(null);

    await expect(service.close(siteId, userId, batchId, dto)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('rejette un batch qui n’est pas EN_COURS', async () => {
    prisma.batch.findFirst.mockResolvedValue({
      ...runningBatch,
      status: BatchStatus.PLANIFIE,
    });

    await expect(service.close(siteId, userId, batchId, dto)).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejette un batch qui n’a pas atteint l’étape CONDITIONNEMENT', async () => {
    prisma.batch.findFirst.mockResolvedValue({
      ...runningBatch,
      currentStep: BatchStep.MELANGE,
    });

    await expect(service.close(siteId, userId, batchId, dto)).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejette si un arrêt est encore ouvert', async () => {
    prisma.batch.findFirst.mockResolvedValue(runningBatch);
    prisma.batchStop.findFirst.mockResolvedValue({
      id: 'stop-1',
      endedAt: null,
    });

    await expect(service.close(siteId, userId, batchId, dto)).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejette une quantité totale nulle (produite + rebuts = 0)', async () => {
    prisma.batch.findFirst.mockResolvedValue(runningBatch);
    prisma.batchStop.findFirst.mockResolvedValue(null);

    await expect(
      service.close(siteId, userId, batchId, {
        ...dto,
        producedQuantity: 0,
        rejectedQuantity: 0,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  describe('cas nominal', () => {
    beforeEach(() => {
      prisma.batch.findFirst.mockResolvedValue(runningBatch);
      prisma.batchStop.findFirst.mockResolvedValue(null);
      lotNumberGeneratorService.generate.mockResolvedValue('455001');
      tx.lot.create.mockResolvedValue({ id: 'lot-1', lotNumber: '455001' });
      tx.batch.update.mockResolvedValue({
        id: batchId,
        status: BatchStatus.TERMINE,
      });
    });

    it('génère le lot avec la quantité totale (produite + rebuts) et déduit le stock', async () => {
      batchPreparationService.computeIngredientQuantities.mockResolvedValue([
        {
          kind: 'MATIERE_PREMIERE',
          articleId: 'mp-1',
          articleName: 'Parfum lavande',
          volumeL: 50,
          massKg: 45,
        },
        {
          kind: 'PACKAGING',
          articleId: 'pkg-1',
          articleName: 'Flacon 100 ml',
          quantity: 500,
          unit: 'unité',
        },
      ]);
      tx.stockLot.findMany
        .mockResolvedValueOnce([stockLot('lot-mp-A', 100)])
        .mockResolvedValueOnce([stockLot('lot-pkg-A', 1000)]);

      const result = await service.close(siteId, userId, batchId, dto);

      expect(
        batchPreparationService.computeIngredientQuantities,
      ).toHaveBeenCalledWith(siteId, runningBatch.recipeId, 500);

      const lotCreateArgs = tx.lot.create.mock.calls[0][0] as {
        data: { quantity: number; lotNumber: string; batchId: string };
      };
      expect(lotCreateArgs.data.quantity).toBe(500);
      expect(lotCreateArgs.data.lotNumber).toBe('455001');
      expect(lotCreateArgs.data.batchId).toBe(batchId);

      const stockLotUpdateArgs = (
        tx.stockLot.update.mock.calls as Array<
          [
            {
              where: { id: string };
              data: { remainingQuantity: { decrement: Prisma.Decimal } };
            },
          ]
        >
      ).map((call) => call[0]);
      expect(
        stockLotUpdateArgs
          .find((a) => a.where.id === 'lot-mp-A')
          ?.data.remainingQuantity.decrement.toString(),
      ).toBe('50');
      expect(
        stockLotUpdateArgs
          .find((a) => a.where.id === 'lot-pkg-A')
          ?.data.remainingQuantity.decrement.toString(),
      ).toBe('500');
      expect(tx.stockMovement.create).toHaveBeenCalledTimes(2);
      expect(tx.lotGenealogy.create).toHaveBeenCalledTimes(2);

      const movementArgs = (
        tx.stockMovement.create.mock.calls as Array<
          [{ data: { type: string; articleId: string } }]
        >
      ).map((call) => call[0].data);
      expect(
        movementArgs.every((m) => m.type === StockMovementType.SORTIE_BATCH),
      ).toBe(true);
      expect(movementArgs.map((m) => m.articleId).sort()).toEqual([
        'mp-1',
        'pkg-1',
      ]);

      const batchUpdateArgs = tx.batch.update.mock.calls[0][0] as {
        data: {
          status: string;
          producedQuantity: number;
          rejectedQuantity: number;
          formatChanged: boolean;
        };
      };
      expect(batchUpdateArgs.data.status).toBe(BatchStatus.TERMINE);
      expect(batchUpdateArgs.data.producedQuantity).toBe(480);
      expect(batchUpdateArgs.data.rejectedQuantity).toBe(20);
      expect(batchUpdateArgs.data.formatChanged).toBe(false);

      expect(result).toEqual({
        batch: { id: batchId, status: BatchStatus.TERMINE },
        lot: { id: 'lot-1', lotNumber: '455001' },
      });
    });

    it('répartit la consommation sur plusieurs StockLot (FIFO) et crée une ligne de généalogie par lot consommé', async () => {
      batchPreparationService.computeIngredientQuantities.mockResolvedValue([
        {
          kind: 'MATIERE_PREMIERE',
          articleId: 'mp-1',
          articleName: 'Parfum lavande',
          volumeL: 50,
          massKg: null,
        },
      ]);
      tx.stockLot.findMany.mockResolvedValueOnce([
        stockLot('lot-A', 30),
        stockLot('lot-B', 40),
      ]);

      await service.close(siteId, userId, batchId, dto);

      expect(tx.lotGenealogy.create).toHaveBeenCalledTimes(2);
      expect(tx.stockMovement.create).toHaveBeenCalledTimes(2);

      const stockLotUpdateArgs = (
        tx.stockLot.update.mock.calls as Array<
          [
            {
              where: { id: string };
              data: { remainingQuantity: { decrement: Prisma.Decimal } };
            },
          ]
        >
      ).map((call) => call[0]);
      expect(
        stockLotUpdateArgs
          .find((a) => a.where.id === 'lot-A')
          ?.data.remainingQuantity.decrement.toString(),
      ).toBe('30');
      expect(
        stockLotUpdateArgs
          .find((a) => a.where.id === 'lot-B')
          ?.data.remainingQuantity.decrement.toString(),
      ).toBe('20');
    });

    it('utilise expiryDate = null quand non fourni', async () => {
      batchPreparationService.computeIngredientQuantities.mockResolvedValue([]);

      await service.close(siteId, userId, batchId, dto);

      const lotCreateArgs = tx.lot.create.mock.calls[0][0] as {
        data: { expiryDate: Date | null };
      };
      expect(lotCreateArgs.data.expiryDate).toBeNull();
    });

    it('convertit expiryDate en Date quand fourni', async () => {
      batchPreparationService.computeIngredientQuantities.mockResolvedValue([]);

      await service.close(siteId, userId, batchId, {
        ...dto,
        expiryDate: '2028-01-01',
      });

      const lotCreateArgs = tx.lot.create.mock.calls[0][0] as {
        data: { expiryDate: Date | null };
      };
      expect(lotCreateArgs.data.expiryDate).toEqual(new Date('2028-01-01'));
    });

    it('transmet formatChanged/formatChangeDetail au batch', async () => {
      batchPreparationService.computeIngredientQuantities.mockResolvedValue([]);

      await service.close(siteId, userId, batchId, {
        ...dto,
        formatChanged: true,
        formatChangeDetail: 'Passage 100ml -> 200ml',
      });

      const batchUpdateArgs = tx.batch.update.mock.calls[0][0] as {
        data: { formatChanged: boolean; formatChangeDetail: string };
      };
      expect(batchUpdateArgs.data.formatChanged).toBe(true);
      expect(batchUpdateArgs.data.formatChangeDetail).toBe(
        'Passage 100ml -> 200ml',
      );
    });
  });

  describe('stock insuffisant', () => {
    beforeEach(() => {
      prisma.batch.findFirst.mockResolvedValue(runningBatch);
      prisma.batchStop.findFirst.mockResolvedValue(null);
    });

    it('rejette et n’écrit rien si un seul article est en rupture', async () => {
      batchPreparationService.computeIngredientQuantities.mockResolvedValue([
        {
          kind: 'MATIERE_PREMIERE',
          articleId: 'mp-1',
          articleName: 'Parfum lavande',
          volumeL: 50,
          massKg: null,
        },
      ]);
      tx.stockLot.findMany.mockResolvedValueOnce([stockLot('lot-A', 10)]);

      await expect(service.close(siteId, userId, batchId, dto)).rejects.toThrow(
        /Stock insuffisant pour clôturer ce batch : Parfum lavande/,
      );
      expect(tx.lot.create).not.toHaveBeenCalled();
      expect(tx.batch.update).not.toHaveBeenCalled();
    });

    it('liste tous les articles en rupture dans un seul message agrégé', async () => {
      batchPreparationService.computeIngredientQuantities.mockResolvedValue([
        {
          kind: 'MATIERE_PREMIERE',
          articleId: 'mp-1',
          articleName: 'Parfum lavande',
          volumeL: 50,
          massKg: null,
        },
        {
          kind: 'PACKAGING',
          articleId: 'pkg-1',
          articleName: 'Flacon 100 ml',
          quantity: 500,
          unit: 'unité',
        },
      ]);
      tx.stockLot.findMany
        .mockResolvedValueOnce([stockLot('lot-A', 10)])
        .mockResolvedValueOnce([stockLot('lot-pkg', 5)]);

      const error = await service
        .close(siteId, userId, batchId, dto)
        .catch((e: Error) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as Error).message).toContain('Parfum lavande');
      expect((error as Error).message).toContain('Flacon 100 ml');
      expect(tx.lot.create).not.toHaveBeenCalled();
    });
  });
});
