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
    batchProductAllocation: {
      update: jest.Mock<Promise<unknown>, [Record<string, unknown>]>;
    };
  };

  const siteId = 'site-1';
  const userId = 'user-1';
  const batchId = 'batch-1';

  const materialQuantity = (
    articleId: string,
    articleName: string,
    volumeL: number,
  ) => ({
    kind: 'MATIERE_PREMIERE' as const,
    articleId,
    articleName,
    articleReference: `REF-${articleId}`,
    volumeL,
    massKg: null,
  });

  const packagingQuantity = (
    articleId: string,
    articleName: string,
    quantity: number,
  ) => ({
    kind: 'PACKAGING' as const,
    articleId,
    articleName,
    articleReference: `REF-${articleId}`,
    quantity,
    unit: 'unité',
  });

  const stockLot = (id: string, remaining: number) => ({
    id,
    remainingQuantity: new Prisma.Decimal(remaining),
  });

  const allocationA = {
    id: 'alloc-A',
    recipeId: 'recipe-A',
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
  };
  const allocationB = {
    id: 'alloc-B',
    recipeId: 'recipe-B',
    createdAt: new Date('2026-07-02T00:00:00.000Z'),
  };

  const baseBatch = {
    id: batchId,
    siteId,
    recipeId: 'recipe-1',
    status: BatchStatus.EN_COURS,
    currentStep: BatchStep.CONDITIONNEMENT,
  };

  const historicalBatch = {
    ...baseBatch,
    allocations: [] as (typeof allocationA)[],
  };
  const oneAllocationBatch = { ...baseBatch, allocations: [allocationA] };
  const twoAllocationsBatch = {
    ...baseBatch,
    allocations: [allocationA, allocationB],
  };

  const historicalDto = {
    producedQuantity: 480,
    rejectedQuantity: 20,
    endedAt: '2026-07-06T16:00:00.000Z',
  };

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
      batchProductAllocation: {
        update: jest.fn<Promise<unknown>, [Record<string, unknown>]>(),
      },
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

    let lotCounter = 0;
    lotNumberGeneratorService.generate.mockImplementation(() => {
      lotCounter += 1;
      return Promise.resolve(`45500${lotCounter}`);
    });
    tx.lot.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: `lot-${data.lotNumber as string}`, ...data }),
    );
    tx.batch.update.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: batchId, ...data }),
    );

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

    await expect(
      service.close(siteId, userId, batchId, historicalDto),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejette un batch qui n’est pas EN_COURS', async () => {
    prisma.batch.findFirst.mockResolvedValue({
      ...historicalBatch,
      status: BatchStatus.PLANIFIE,
    });

    await expect(
      service.close(siteId, userId, batchId, historicalDto),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejette un batch qui n’a pas atteint l’étape CONDITIONNEMENT', async () => {
    prisma.batch.findFirst.mockResolvedValue({
      ...historicalBatch,
      currentStep: BatchStep.MELANGE,
    });

    await expect(
      service.close(siteId, userId, batchId, historicalDto),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejette si un arrêt est encore ouvert', async () => {
    prisma.batch.findFirst.mockResolvedValue(historicalBatch);
    prisma.batchStop.findFirst.mockResolvedValue({
      id: 'stop-1',
      endedAt: null,
    });

    await expect(
      service.close(siteId, userId, batchId, historicalDto),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  describe('payload et bijection', () => {
    beforeEach(() => {
      prisma.batchStop.findFirst.mockResolvedValue(null);
    });

    it('rejette un payload ambigu (champs racine ET allocations non vide)', async () => {
      prisma.batch.findFirst.mockResolvedValue(oneAllocationBatch);

      await expect(
        service.close(siteId, userId, batchId, {
          endedAt: historicalDto.endedAt,
          producedQuantity: 100,
          rejectedQuantity: 0,
          allocations: [
            {
              allocationId: 'alloc-A',
              producedQuantity: 100,
              rejectedQuantity: 0,
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejette un batch sans allocation si producedQuantity/rejectedQuantity racine sont absents', async () => {
      prisma.batch.findFirst.mockResolvedValue(historicalBatch);

      await expect(
        service.close(siteId, userId, batchId, {
          endedAt: historicalDto.endedAt,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejette un batch avec allocations si le tableau allocations est absent ou vide', async () => {
      prisma.batch.findFirst.mockResolvedValue(oneAllocationBatch);

      await expect(
        service.close(siteId, userId, batchId, {
          endedAt: historicalDto.endedAt,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejette un allocationId dupliqué dans le tableau', async () => {
      prisma.batch.findFirst.mockResolvedValue(twoAllocationsBatch);

      await expect(
        service.close(siteId, userId, batchId, {
          endedAt: historicalDto.endedAt,
          allocations: [
            {
              allocationId: 'alloc-A',
              producedQuantity: 100,
              rejectedQuantity: 0,
            },
            {
              allocationId: 'alloc-A',
              producedQuantity: 50,
              rejectedQuantity: 0,
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejette une allocation manquante dans le tableau', async () => {
      prisma.batch.findFirst.mockResolvedValue(twoAllocationsBatch);

      await expect(
        service.close(siteId, userId, batchId, {
          endedAt: historicalDto.endedAt,
          allocations: [
            {
              allocationId: 'alloc-A',
              producedQuantity: 100,
              rejectedQuantity: 0,
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejette un allocationId étranger (surnuméraire, appartenant à un autre batch)', async () => {
      prisma.batch.findFirst.mockResolvedValue(oneAllocationBatch);

      await expect(
        service.close(siteId, userId, batchId, {
          endedAt: historicalDto.endedAt,
          allocations: [
            {
              allocationId: 'alloc-A',
              producedQuantity: 100,
              rejectedQuantity: 0,
            },
            {
              allocationId: 'alloc-étranger',
              producedQuantity: 50,
              rejectedQuantity: 0,
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejette une quantité totale nulle (batch sans allocation)', async () => {
      prisma.batch.findFirst.mockResolvedValue(historicalBatch);

      await expect(
        service.close(siteId, userId, batchId, {
          ...historicalDto,
          producedQuantity: 0,
          rejectedQuantity: 0,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejette une quantité totale nulle sur l’ensemble des allocations', async () => {
      prisma.batch.findFirst.mockResolvedValue(twoAllocationsBatch);

      await expect(
        service.close(siteId, userId, batchId, {
          endedAt: historicalDto.endedAt,
          allocations: [
            {
              allocationId: 'alloc-A',
              producedQuantity: 0,
              rejectedQuantity: 0,
            },
            {
              allocationId: 'alloc-B',
              producedQuantity: 0,
              rejectedQuantity: 0,
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('cas historique (sans allocation) — non-régression', () => {
    beforeEach(() => {
      prisma.batch.findFirst.mockResolvedValue(historicalBatch);
      prisma.batchStop.findFirst.mockResolvedValue(null);
    });

    it('génère un lot unique avec la quantité totale (produite + rebuts), sans allocationId', async () => {
      batchPreparationService.computeIngredientQuantities.mockResolvedValue([
        materialQuantity('mp-1', 'Parfum lavande', 50),
        packagingQuantity('pkg-1', 'Flacon 100 ml', 500),
      ]);
      tx.stockLot.findMany
        .mockResolvedValueOnce([stockLot('lot-mp-A', 100)])
        .mockResolvedValueOnce([stockLot('lot-pkg-A', 1000)]);

      const result = await service.close(
        siteId,
        userId,
        batchId,
        historicalDto,
      );

      expect(
        batchPreparationService.computeIngredientQuantities,
      ).toHaveBeenCalledWith(siteId, 'recipe-1', 500);
      // Une seule lecture de la recette de référence, réutilisée pour la matière ET
      // le packaging (repli historique) — pas d'appel redondant.
      expect(
        batchPreparationService.computeIngredientQuantities,
      ).toHaveBeenCalledTimes(1);

      expect(tx.lot.create).toHaveBeenCalledTimes(1);
      const lotArgs = tx.lot.create.mock.calls[0][0] as {
        data: {
          quantity: number;
          allocationId: string | null;
          batchId: string;
        };
      };
      expect(lotArgs.data.quantity).toBe(500);
      expect(lotArgs.data.allocationId).toBeNull();
      expect(lotArgs.data.batchId).toBe(batchId);

      expect(tx.stockMovement.create).toHaveBeenCalledTimes(2);
      const movementArgs = (
        tx.stockMovement.create.mock.calls as Array<
          [{ data: { batchProductAllocationId: string | null } }]
        >
      ).map((call) => call[0].data);
      expect(
        movementArgs.every((m) => m.batchProductAllocationId === null),
      ).toBe(true);

      const batchUpdateArgs = tx.batch.update.mock.calls[0][0] as {
        data: { producedQuantity: number; rejectedQuantity: number };
      };
      expect(batchUpdateArgs.data.producedQuantity).toBe(480);
      expect(batchUpdateArgs.data.rejectedQuantity).toBe(20);

      expect(result.lots).toHaveLength(1);
      expect(result.lot).toBe(result.lots[0]);
    });

    it('répartit la consommation sur plusieurs StockLot (FIFO) et crée une ligne de généalogie par lot consommé', async () => {
      batchPreparationService.computeIngredientQuantities.mockResolvedValue([
        materialQuantity('mp-1', 'Parfum lavande', 50),
      ]);
      tx.stockLot.findMany.mockResolvedValueOnce([
        stockLot('lot-A', 30),
        stockLot('lot-B', 40),
      ]);

      await service.close(siteId, userId, batchId, historicalDto);

      expect(tx.lotGenealogy.create).toHaveBeenCalledTimes(2);
      expect(tx.stockMovement.create).toHaveBeenCalledTimes(2);
    });

    it('rejette et n’écrit rien si un seul article est en rupture', async () => {
      batchPreparationService.computeIngredientQuantities.mockResolvedValue([
        materialQuantity('mp-1', 'Parfum lavande', 50),
      ]);
      tx.stockLot.findMany.mockResolvedValueOnce([stockLot('lot-A', 10)]);

      await expect(
        service.close(siteId, userId, batchId, historicalDto),
      ).rejects.toThrow(
        /Stock insuffisant pour clôturer ce batch : Parfum lavande/,
      );
      expect(tx.lot.create).not.toHaveBeenCalled();
      expect(tx.batch.update).not.toHaveBeenCalled();
    });

    it('utilise expiryDate = null quand non fourni', async () => {
      batchPreparationService.computeIngredientQuantities.mockResolvedValue([]);

      await service.close(siteId, userId, batchId, historicalDto);

      const lotArgs = tx.lot.create.mock.calls[0][0] as {
        data: { expiryDate: Date | null };
      };
      expect(lotArgs.data.expiryDate).toBeNull();
    });
  });

  describe('une allocation', () => {
    const dto = {
      endedAt: historicalDto.endedAt,
      allocations: [
        {
          allocationId: 'alloc-A',
          producedQuantity: 300,
          rejectedQuantity: 10,
        },
      ],
    };

    beforeEach(() => {
      prisma.batch.findFirst.mockResolvedValue(oneAllocationBatch);
      prisma.batchStop.findFirst.mockResolvedValue(null);
      batchPreparationService.computeIngredientQuantities.mockImplementation(
        (_siteId: string, recipeId: string) => {
          if (recipeId === 'recipe-1') {
            return Promise.resolve([
              materialQuantity('mp-1', 'Parfum lavande', 31),
            ]);
          }
          if (recipeId === 'recipe-A') {
            return Promise.resolve([
              packagingQuantity('flacon', 'Flacon 100 ml', 310),
            ]);
          }
          throw new Error(`recipeId inattendu ${recipeId}`);
        },
      );
      tx.stockLot.findMany.mockResolvedValue([stockLot('lot-1', 1000)]);
    });

    it('crée un seul lot, avec l’allocationId renseigné et batchProductAllocationId sur le mouvement packaging', async () => {
      const result = await service.close(siteId, userId, batchId, dto);

      expect(tx.lot.create).toHaveBeenCalledTimes(1);
      const lotArgs = tx.lot.create.mock.calls[0][0] as {
        data: { allocationId: string; quantity: number };
      };
      expect(lotArgs.data.allocationId).toBe('alloc-A');
      expect(lotArgs.data.quantity).toBe(310);

      expect(tx.batchProductAllocation.update).toHaveBeenCalledWith({
        where: { id: 'alloc-A' },
        data: { producedQuantity: 300, rejectedQuantity: 10 },
      });

      expect(result.lots).toHaveLength(1);
      expect(result.lot).toBe(result.lots[0]);
    });

    it('compatibilité transitoire : accepte l’ancien format (champs racine) pour un batch à une seule allocation', async () => {
      const result = await service.close(siteId, userId, batchId, {
        endedAt: historicalDto.endedAt,
        producedQuantity: 300,
        rejectedQuantity: 10,
      });

      expect(tx.lot.create).toHaveBeenCalledTimes(1);
      const lotArgs = tx.lot.create.mock.calls[0][0] as {
        data: { allocationId: string; quantity: number };
      };
      expect(lotArgs.data.allocationId).toBe('alloc-A');
      expect(lotArgs.data.quantity).toBe(310);

      expect(tx.batchProductAllocation.update).toHaveBeenCalledWith({
        where: { id: 'alloc-A' },
        data: { producedQuantity: 300, rejectedQuantity: 10 },
      });
      expect(result.lots).toHaveLength(1);
      expect(result.lot).toBe(result.lots[0]);
    });

    it('rejette un payload ambigu (ancien ET nouveau format) même pour une seule allocation', async () => {
      await expect(
        service.close(siteId, userId, batchId, {
          endedAt: historicalDto.endedAt,
          producedQuantity: 300,
          rejectedQuantity: 10,
          allocations: [
            {
              allocationId: 'alloc-A',
              producedQuantity: 300,
              rejectedQuantity: 10,
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('deux allocations', () => {
    const dto = {
      endedAt: historicalDto.endedAt,
      allocations: [
        {
          allocationId: 'alloc-A',
          producedQuantity: 300,
          rejectedQuantity: 10,
        },
        { allocationId: 'alloc-B', producedQuantity: 150, rejectedQuantity: 5 },
      ],
    };

    beforeEach(() => {
      prisma.batch.findFirst.mockResolvedValue(twoAllocationsBatch);
      prisma.batchStop.findFirst.mockResolvedValue(null);
    });

    it('rejette l’ancien format (champs racine) dès que le batch a plusieurs allocations', async () => {
      await expect(
        service.close(siteId, userId, batchId, {
          endedAt: historicalDto.endedAt,
          producedQuantity: 450,
          rejectedQuantity: 15,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('calcule la matière une seule fois (recette de référence, quantité totale) et le packaging par allocation', async () => {
      batchPreparationService.computeIngredientQuantities.mockImplementation(
        (_siteId: string, recipeId: string) => {
          if (recipeId === 'recipe-1') {
            return Promise.resolve([
              materialQuantity('mp-1', 'Parfum lavande', 46.5),
            ]);
          }
          if (recipeId === 'recipe-A') {
            return Promise.resolve([
              packagingQuantity('flacon-fr', 'Flacon FR', 310),
            ]);
          }
          if (recipeId === 'recipe-B') {
            return Promise.resolve([
              packagingQuantity('flacon-ch', 'Flacon CH', 155),
            ]);
          }
          throw new Error(`recipeId inattendu ${recipeId}`);
        },
      );
      tx.stockLot.findMany.mockResolvedValue([stockLot('lot-1', 10000)]);

      await service.close(siteId, userId, batchId, dto);

      // Matière : un seul appel, sur la recette de référence et la quantité totale
      // traitée (310 + 155 = 465).
      const materialCalls = (
        batchPreparationService.computeIngredientQuantities.mock.calls as Array<
          [string, string, number]
        >
      ).filter((call) => call[1] === 'recipe-1');
      expect(materialCalls).toHaveLength(1);
      expect(materialCalls[0][2]).toBe(465);

      // Packaging : un appel par allocation, sur sa propre recette et sa propre
      // quantité traitée.
      expect(
        batchPreparationService.computeIngredientQuantities,
      ).toHaveBeenCalledWith(siteId, 'recipe-A', 310);
      expect(
        batchPreparationService.computeIngredientQuantities,
      ).toHaveBeenCalledWith(siteId, 'recipe-B', 155);

      expect(tx.lot.create).toHaveBeenCalledTimes(2);
    });

    it('crée un Lot par allocation, avec les bons agrégats dérivés sur le Batch', async () => {
      batchPreparationService.computeIngredientQuantities.mockImplementation(
        (_siteId: string, recipeId: string) =>
          recipeId === 'recipe-1'
            ? Promise.resolve([materialQuantity('mp-1', 'MP', 1)])
            : Promise.resolve([]),
      );
      tx.stockLot.findMany.mockResolvedValue([stockLot('lot-1', 10000)]);

      await service.close(siteId, userId, batchId, dto);

      expect(tx.lot.create).toHaveBeenCalledTimes(2);
      const allocationIds = (
        tx.lot.create.mock.calls as Array<[{ data: { allocationId: string } }]>
      ).map((call) => call[0].data.allocationId);
      expect(allocationIds.sort()).toEqual(['alloc-A', 'alloc-B']);

      const batchUpdateArgs = tx.batch.update.mock.calls[0][0] as {
        data: { producedQuantity: number; rejectedQuantity: number };
      };
      expect(batchUpdateArgs.data.producedQuantity).toBe(450); // 300 + 150
      expect(batchUpdateArgs.data.rejectedQuantity).toBe(15); // 10 + 5
    });

    it('applique la même expiryDate à tous les lots générés', async () => {
      batchPreparationService.computeIngredientQuantities.mockResolvedValue([]);
      tx.stockLot.findMany.mockResolvedValue([]);

      await service.close(siteId, userId, batchId, {
        ...dto,
        expiryDate: '2028-01-01',
      });

      const expiryDates = (
        tx.lot.create.mock.calls as Array<
          [{ data: { expiryDate: Date | null } }]
        >
      ).map((call) => call[0].data.expiryDate);
      expect(expiryDates).toHaveLength(2);
      expect(expiryDates[0]).toEqual(new Date('2028-01-01'));
      expect(expiryDates[1]).toEqual(new Date('2028-01-01'));
    });

    it('quand deux allocations partagent le même article de packaging, la seconde consomme le stock déjà réduit par la première', async () => {
      batchPreparationService.computeIngredientQuantities.mockImplementation(
        (_siteId: string, recipeId: string) => {
          if (recipeId === 'recipe-1') return Promise.resolve([]);
          if (recipeId === 'recipe-A') {
            return Promise.resolve([
              packagingQuantity('bouchon', 'Bouchon partagé', 10),
            ]);
          }
          return Promise.resolve([
            packagingQuantity('bouchon', 'Bouchon partagé', 8),
          ]);
        },
      );
      tx.stockLot.findMany.mockResolvedValue([stockLot('lot-bouchon', 20)]);

      await service.close(siteId, userId, batchId, dto);

      // Une seule lecture de stock pour cet article, partagée entre les deux allocations.
      expect(tx.stockLot.findMany).toHaveBeenCalledTimes(1);

      const decrementCalls = (
        tx.stockLot.update.mock.calls as Array<
          [{ data: { remainingQuantity: { decrement: Prisma.Decimal } } }]
        >
      ).map((call) => call[0].data.remainingQuantity.decrement);
      expect(decrementCalls).toHaveLength(2);
      const total = decrementCalls.reduce(
        (sum, d) => sum.plus(d),
        new Prisma.Decimal(0),
      );
      expect(total.toString()).toBe('18'); // 10 + 8, jamais compté une seule fois
    });

    it('rejette et n’écrit rien si la rupture de stock packaging n’apparaît que sur la seconde allocation traitée', async () => {
      batchPreparationService.computeIngredientQuantities.mockImplementation(
        (_siteId: string, recipeId: string) => {
          if (recipeId === 'recipe-1') return Promise.resolve([]);
          if (recipeId === 'recipe-A') {
            return Promise.resolve([
              packagingQuantity('bouchon', 'Bouchon partagé', 10),
            ]);
          }
          return Promise.resolve([
            packagingQuantity('bouchon', 'Bouchon partagé', 8),
          ]);
        },
      );
      // 12 disponibles : suffisant pour A seule (10) mais pas pour la somme (18).
      tx.stockLot.findMany.mockResolvedValue([stockLot('lot-bouchon', 12)]);

      await expect(service.close(siteId, userId, batchId, dto)).rejects.toThrow(
        BadRequestException,
      );
      expect(tx.lot.create).not.toHaveBeenCalled();
      expect(tx.stockLot.update).not.toHaveBeenCalled();
      expect(tx.batch.update).not.toHaveBeenCalled();
    });

    it('rejette et n’écrit rien en cas de rupture sur la matière première commune', async () => {
      batchPreparationService.computeIngredientQuantities.mockImplementation(
        (_siteId: string, recipeId: string) =>
          recipeId === 'recipe-1'
            ? Promise.resolve([materialQuantity('mp-1', 'Parfum lavande', 100)])
            : Promise.resolve([]),
      );
      tx.stockLot.findMany.mockResolvedValue([stockLot('lot-mp', 10)]);

      await expect(service.close(siteId, userId, batchId, dto)).rejects.toThrow(
        /Stock insuffisant pour clôturer ce batch : Parfum lavande/,
      );
      expect(tx.lot.create).not.toHaveBeenCalled();
      expect(tx.batch.update).not.toHaveBeenCalled();
    });

    it('répartit la généalogie matière première au prorata de la quantité traitée, reliquat sur la dernière allocation éligible', async () => {
      // A (créée avant B) : quantité traitée = 100 ; B : quantité traitée = 200.
      // StockLot consommé : 10 (Decimal) — 10 * 100/300 = 3.333... pour A ; le reliquat
      // exact (10 - part de A) est affecté à B (créée après, dernière dans l'ordre).
      batchPreparationService.computeIngredientQuantities.mockImplementation(
        (_siteId: string, recipeId: string) =>
          recipeId === 'recipe-1'
            ? Promise.resolve([materialQuantity('mp-1', 'MP', 10)])
            : Promise.resolve([]),
      );
      tx.stockLot.findMany.mockResolvedValue([stockLot('lot-mp', 1000)]);

      await service.close(siteId, userId, batchId, {
        endedAt: dto.endedAt,
        allocations: [
          {
            allocationId: 'alloc-A',
            producedQuantity: 100,
            rejectedQuantity: 0,
          },
          {
            allocationId: 'alloc-B',
            producedQuantity: 200,
            rejectedQuantity: 0,
          },
        ],
      });

      expect(tx.lotGenealogy.create).toHaveBeenCalledTimes(2);
      const consumedQuantities = (
        tx.lotGenealogy.create.mock.calls as Array<
          [{ data: { consumedQuantity: Prisma.Decimal; lotId: string } }]
        >
      ).map((call) => call[0].data.consumedQuantity);

      const total = consumedQuantities.reduce(
        (sum, q) => sum.plus(q),
        new Prisma.Decimal(0),
      );
      // Reconstitution exacte de la quantité réellement consommée au StockLot.
      expect(total.toString()).toBe('10');

      // La part de A (première dans l'ordre) est calculée par division ; celle de B
      // (dernière) est le reliquat exact, jamais recalculée au prorata.
      const shareA = consumedQuantities[0];
      const shareB = consumedQuantities[1];
      expect(shareA.toString()).toBe(
        new Prisma.Decimal(10).times(100).dividedBy(300).toString(),
      );
      expect(shareB.toString()).toBe(
        new Prisma.Decimal(10).minus(shareA).toString(),
      );
    });
  });

  describe('allocation à quantité traitée nulle (0/0)', () => {
    const dto = {
      endedAt: historicalDto.endedAt,
      allocations: [
        {
          allocationId: 'alloc-A',
          producedQuantity: 300,
          rejectedQuantity: 10,
        },
        { allocationId: 'alloc-B', producedQuantity: 0, rejectedQuantity: 0 },
      ],
    };

    beforeEach(() => {
      prisma.batch.findFirst.mockResolvedValue(twoAllocationsBatch);
      prisma.batchStop.findFirst.mockResolvedValue(null);
      batchPreparationService.computeIngredientQuantities.mockImplementation(
        (_siteId: string, recipeId: string) => {
          if (recipeId === 'recipe-1') {
            return Promise.resolve([materialQuantity('mp-1', 'MP', 31)]);
          }
          if (recipeId === 'recipe-A') {
            return Promise.resolve([
              packagingQuantity('flacon', 'Flacon', 310),
            ]);
          }
          throw new Error(
            `recette de l'allocation à quantité nulle interrogée à tort : ${recipeId}`,
          );
        },
      );
      tx.stockLot.findMany.mockResolvedValue([stockLot('lot-1', 10000)]);
    });

    it('ne crée aucun Lot pour l’allocation à quantité traitée nulle', async () => {
      await service.close(siteId, userId, batchId, dto);

      expect(tx.lot.create).toHaveBeenCalledTimes(1);
      const allocationIds = (
        tx.lot.create.mock.calls as Array<[{ data: { allocationId: string } }]>
      ).map((call) => call[0].data.allocationId);
      expect(allocationIds).toEqual(['alloc-A']);
    });

    it('clôture malgré tout l’allocation à quantité nulle (quantités enregistrées à 0/0)', async () => {
      await service.close(siteId, userId, batchId, dto);

      expect(tx.batchProductAllocation.update).toHaveBeenCalledWith({
        where: { id: 'alloc-B' },
        data: { producedQuantity: 0, rejectedQuantity: 0 },
      });
    });

    it('ne calcule ni ne consomme aucun packaging pour l’allocation à quantité nulle', async () => {
      await service.close(siteId, userId, batchId, dto);

      expect(
        batchPreparationService.computeIngredientQuantities,
      ).not.toHaveBeenCalledWith(siteId, 'recipe-B', expect.anything());
    });

    it('ne génère aucune ligne de généalogie ni mouvement pour l’allocation à quantité nulle', async () => {
      await service.close(siteId, userId, batchId, dto);

      const movementAllocationIds = (
        tx.stockMovement.create.mock.calls as Array<
          [{ data: { batchProductAllocationId: string | null } }]
        >
      ).map((call) => call[0].data.batchProductAllocationId);
      expect(movementAllocationIds).not.toContain('alloc-B');

      // Toute la généalogie matière (répartie sur les lignes éligibles) référence
      // uniquement le lot de alloc-A, jamais un lot inexistant pour alloc-B.
      const lotIds = (
        tx.lotGenealogy.create.mock.calls as Array<
          [{ data: { lotId: string } }]
        >
      ).map((call) => call[0].data.lotId);
      expect(new Set(lotIds).size).toBe(1);
    });
  });
});
