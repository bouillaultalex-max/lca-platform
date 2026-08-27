import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TraceabilityService } from './traceability.service';
import { PrismaService } from '../prisma/prisma.service';
import { LotQualityStatus } from '../../generated/prisma/client';

describe('TraceabilityService', () => {
  let service: TraceabilityService;
  let prisma: {
    lot: { findFirst: jest.Mock; findMany: jest.Mock };
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
        finishedProduct: {
          id: 'article-fp-1',
          name: 'Recharge Lavande 100 ml',
        },
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
      lot: { findFirst: jest.fn(), findMany: jest.fn() },
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

  describe('findLotTraceabilityByNumber (ADR 0010 § Décision 15 : liste, plus objet unique)', () => {
    const lotWithRelationsB = {
      ...lotWithRelations,
      id: 'lot-2',
      batch: { ...lotWithRelations.batch, id: 'batch-2' },
      genealogyLines: [
        {
          id: 'genealogy-2',
          consumedQuantity: 7,
          consumedArticle: { id: 'article-2', name: 'Flacon 100 ml' },
          consumedStockLot: {
            id: 'stock-lot-2',
            supplierLotNumber: 'FOURNISSEUR-LOT-10',
          },
        },
      ],
    };

    it('utilise findMany (jamais findFirst) avec le même include que la recherche par id', async () => {
      prisma.lot.findMany.mockResolvedValue([lotWithRelations]);

      await service.findLotTraceabilityByNumber(siteId, '455001');

      expect(prisma.lot.findMany).toHaveBeenCalledWith({
        where: { lotNumber: '455001', siteId },
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
        orderBy: { createdAt: 'asc' },
      });
      expect(prisma.lot.findFirst).not.toHaveBeenCalled();
    });

    it('zéro résultat : retourne un tableau vide, jamais NotFoundException', async () => {
      prisma.lot.findMany.mockResolvedValue([]);

      const result = await service.findLotTraceabilityByNumber(
        siteId,
        '455999',
      );

      expect(result).toEqual([]);
    });

    it('un seul résultat : retourne un tableau à un élément (jamais l’objet nu)', async () => {
      prisma.lot.findMany.mockResolvedValue([lotWithRelations]);

      const result = await service.findLotTraceabilityByNumber(
        siteId,
        '455001',
      );

      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual([lotWithRelations]);
    });

    it('plusieurs résultats (numéro partagé par deux allocations d’un même batch) : les deux sont retournés, jamais fusionnés ni dédupliqués par lotNumber', async () => {
      prisma.lot.findMany.mockResolvedValue([
        lotWithRelations,
        lotWithRelationsB,
      ]);

      const result = await service.findLotTraceabilityByNumber(
        siteId,
        '455001',
      );

      expect(result).toHaveLength(2);
      expect(result).toEqual([lotWithRelations, lotWithRelationsB]);
      // Identité technique distincte malgré un lotNumber partagé — jamais lotNumber
      // comme clé d'identité (ADR 0010 § Décision 4/15/16).
      expect(result[0].id).not.toBe(result[1].id);
      expect(result[0].lotNumber).toBe(result[1].lotNumber);
    });

    it('transmet le siteId de l’appelant (isolation cross-site) même pour un tableau vide', async () => {
      prisma.lot.findMany.mockResolvedValue([]);

      await service.findLotTraceabilityByNumber(siteId, '455999');

      expect(prisma.lot.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { lotNumber: '455999', siteId } }),
      );
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
