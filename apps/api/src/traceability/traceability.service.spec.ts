import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TraceabilityService } from './traceability.service';
import { PrismaService } from '../prisma/prisma.service';
import { LotQualityStatus } from '../../generated/prisma/client';

describe('TraceabilityService', () => {
  let service: TraceabilityService;
  let prisma: {
    lot: { findFirst: jest.Mock };
    stockLot: { findFirst: jest.Mock };
  };

  const siteId = 'site-1';

  const lotWithRelations = {
    id: 'lot-1',
    siteId,
    lotNumber: '455001',
    quantity: 1000,
    qualityStatus: LotQualityStatus.EN_ATTENTE,
    batch: {
      id: 'batch-1',
      recipe: {
        id: 'recipe-1',
        finishedProduct: { id: 'article-fp-1', name: 'Recharge Lavande 100 ml' },
      },
    },
    genealogyLines: [
      {
        id: 'genealogy-1',
        consumedQuantity: 12.5,
        consumedArticle: { id: 'article-1', name: 'Huile essentielle Lavande' },
        consumedStockLot: {
          id: 'stock-lot-1',
          supplierLotNumber: 'FOURNISSEUR-LOT-9',
        },
      },
    ],
  };

  const stockLotWithRelations = {
    id: 'stock-lot-1',
    siteId,
    supplierLotNumber: 'FOURNISSEUR-LOT-9',
    genealogyLines: [
      {
        id: 'genealogy-1',
        consumedQuantity: 12.5,
        lot: {
          id: 'lot-1',
          lotNumber: '455001',
          qualityStatus: LotQualityStatus.EN_ATTENTE,
          batch: {
            id: 'batch-1',
            recipe: {
              id: 'recipe-1',
              finishedProduct: {
                id: 'article-fp-1',
                name: 'Recharge Lavande 100 ml',
              },
            },
          },
        },
      },
    ],
  };

  beforeEach(async () => {
    prisma = {
      lot: { findFirst: jest.fn() },
      stockLot: { findFirst: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TraceabilityService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(TraceabilityService);
  });

  describe('findLotTraceability', () => {
    it('renvoie le lot avec batch, recette, produit fini et lignes de généalogie', async () => {
      prisma.lot.findFirst.mockResolvedValue(lotWithRelations);

      const result = await service.findLotTraceability(siteId, 'lot-1');

      expect(prisma.lot.findFirst).toHaveBeenCalledWith({
        where: { id: 'lot-1', siteId },
        include: {
          batch: {
            include: {
              recipe: {
                include: { finishedProduct: true },
              },
            },
          },
          genealogyLines: {
            include: {
              consumedArticle: true,
              consumedStockLot: true,
            },
          },
        },
      });
      expect(result).toEqual(lotWithRelations);
    });

    it('lève NotFoundException si le lot est introuvable sur ce site', async () => {
      prisma.lot.findFirst.mockResolvedValue(null);

      await expect(
        service.findLotTraceability(siteId, 'inconnu'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findStockLotTraceability', () => {
    it('renvoie le StockLot avec tous les lots de production qui l’ont consommé', async () => {
      prisma.stockLot.findFirst.mockResolvedValue(stockLotWithRelations);

      const result = await service.findStockLotTraceability(
        siteId,
        'stock-lot-1',
      );

      expect(prisma.stockLot.findFirst).toHaveBeenCalledWith({
        where: { id: 'stock-lot-1', siteId },
        include: {
          genealogyLines: {
            include: {
              lot: {
                include: {
                  batch: {
                    include: {
                      recipe: {
                        include: { finishedProduct: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });
      expect(result).toEqual(stockLotWithRelations);
    });

    it('lève NotFoundException si le StockLot est introuvable sur ce site', async () => {
      prisma.stockLot.findFirst.mockResolvedValue(null);

      await expect(
        service.findStockLotTraceability(siteId, 'inconnu'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
