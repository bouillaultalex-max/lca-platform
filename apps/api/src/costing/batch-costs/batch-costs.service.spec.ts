import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { BatchCostsService } from './batch-costs.service';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';

describe('BatchCostsService', () => {
  let service: BatchCostsService;
  let prisma: { batchCost: { findFirst: jest.Mock } };

  const siteId = 'site-1';
  const lotId = 'lot-1';

  const batchCostWithLot = {
    id: 'cost-1',
    lotId,
    batchId: 'batch-1',
    materialCostTotal: new Prisma.Decimal(100),
    packagingCostTotal: new Prisma.Decimal(50),
    unitCostPerFlacon: new Prisma.Decimal('0.3'),
    producedQuantityTotal: 500,
    calculatedAt: new Date('2026-08-01T16:00:00.000Z'),
    lot: { id: lotId, siteId, lotNumber: '455001' },
  };

  beforeEach(async () => {
    prisma = { batchCost: { findFirst: jest.fn() } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BatchCostsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(BatchCostsService);
  });

  it("retourne le BatchCost d'un lot du site courant", async () => {
    prisma.batchCost.findFirst.mockResolvedValue(batchCostWithLot);

    const result = await service.findByLotId(siteId, lotId);

    expect(result).toBe(batchCostWithLot);
    expect(prisma.batchCost.findFirst).toHaveBeenCalledWith({
      where: { lotId, lot: { siteId } },
      include: { lot: true },
    });
  });

  it('lève NotFoundException si aucun BatchCost ne correspond (lot inexistant ou d’un autre site)', async () => {
    // Le cloisonnement par site est appliqué via le `where: { lot: { siteId } } }` :
    // un lot d'un autre site ne remonte jamais, sans distinction avec un lot inexistant
    // (même principe que TraceabilityService — ne révèle pas l'existence d'un lot
    // appartenant à un autre site).
    prisma.batchCost.findFirst.mockResolvedValue(null);

    await expect(service.findByLotId(siteId, lotId)).rejects.toThrow(
      NotFoundException,
    );
  });
});
