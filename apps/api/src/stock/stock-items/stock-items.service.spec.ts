import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { StockItemsService } from './stock-items.service';
import { PrismaService } from '../../prisma/prisma.service';
import { Article, ArticleType, Prisma } from '../../../generated/prisma/client';

describe('StockItemsService', () => {
  let service: StockItemsService;
  let prisma: {
    stockItem: { findMany: jest.Mock; findFirst: jest.Mock; update: jest.Mock };
  };

  const siteId = 'site-1';

  const flacon: Article = {
    id: 'article-1',
    siteId,
    type: ArticleType.PACKAGING,
    openSiReference: 'PKG-FLA-100',
    name: 'Flacon 100 ml',
    unitOfMeasure: 'unité',
    currentUnitCost: new Prisma.Decimal(0.35),
    unitsPerCarton: 100,
    active: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  const matierePremiere: Article = {
    ...flacon,
    id: 'article-2',
    type: ArticleType.MATIERE_PREMIERE,
    name: 'Parfum ambiance lavande (vrac)',
    unitsPerCarton: null,
  };

  beforeEach(async () => {
    prisma = {
      stockItem: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StockItemsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(StockItemsService);
  });

  describe('findAll', () => {
    it('filtre par site et par type quand un type est fourni', async () => {
      prisma.stockItem.findMany.mockResolvedValue([]);

      await service.findAll(siteId, ArticleType.PACKAGING);

      expect(prisma.stockItem.findMany).toHaveBeenCalledWith({
        where: { siteId, article: { type: ArticleType.PACKAGING } },
        include: { article: true },
        orderBy: { article: { name: 'asc' } },
      });
    });

    it('calcule l’équivalent en cartons quand unitsPerCarton est renseigné', async () => {
      prisma.stockItem.findMany.mockResolvedValue([
        {
          id: 'stock-item-1',
          siteId,
          articleId: flacon.id,
          article: flacon,
          availableQuantity: new Prisma.Decimal(250),
          minimumThreshold: null,
        },
      ]);

      const result = await service.findAll(siteId);

      expect(result[0].cartonEquivalent).toEqual({
        fullCartons: 2,
        remainderUnits: 50,
      });
    });

    it('retourne cartonEquivalent = null quand unitsPerCarton n’est pas renseigné', async () => {
      prisma.stockItem.findMany.mockResolvedValue([
        {
          id: 'stock-item-2',
          siteId,
          articleId: matierePremiere.id,
          article: matierePremiere,
          availableQuantity: new Prisma.Decimal(80),
          minimumThreshold: null,
        },
      ]);

      const result = await service.findAll(siteId);

      expect(result[0].cartonEquivalent).toBeNull();
    });

    it('signale un stock faible quand la quantité disponible est inférieure ou égale au seuil minimum', async () => {
      prisma.stockItem.findMany.mockResolvedValue([
        {
          id: 'stock-item-1',
          siteId,
          articleId: matierePremiere.id,
          article: matierePremiere,
          availableQuantity: new Prisma.Decimal(20),
          minimumThreshold: new Prisma.Decimal(20),
        },
      ]);

      const result = await service.findAll(siteId);

      expect(result[0].isLowStock).toBe(true);
    });

    it('ne signale pas de stock faible quand la quantité disponible dépasse le seuil', async () => {
      prisma.stockItem.findMany.mockResolvedValue([
        {
          id: 'stock-item-1',
          siteId,
          articleId: matierePremiere.id,
          article: matierePremiere,
          availableQuantity: new Prisma.Decimal(50),
          minimumThreshold: new Prisma.Decimal(20),
        },
      ]);

      const result = await service.findAll(siteId);

      expect(result[0].isLowStock).toBe(false);
    });

    it('retourne isLowStock = null quand aucun seuil n’est défini', async () => {
      prisma.stockItem.findMany.mockResolvedValue([
        {
          id: 'stock-item-1',
          siteId,
          articleId: matierePremiere.id,
          article: matierePremiere,
          availableQuantity: new Prisma.Decimal(50),
          minimumThreshold: null,
        },
      ]);

      const result = await service.findAll(siteId);

      expect(result[0].isLowStock).toBeNull();
    });
  });

  describe('findOne', () => {
    it("lève NotFoundException si aucun stock n'existe pour cet article sur ce site", async () => {
      prisma.stockItem.findFirst.mockResolvedValue(null);

      await expect(service.findOne(siteId, 'inconnu')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('retourne le stock avec équivalent cartons', async () => {
      prisma.stockItem.findFirst.mockResolvedValue({
        id: 'stock-item-1',
        siteId,
        articleId: flacon.id,
        article: flacon,
        availableQuantity: new Prisma.Decimal(136),
        minimumThreshold: null,
      });

      const result = await service.findOne(siteId, flacon.id);

      expect(result.cartonEquivalent).toEqual({
        fullCartons: 1,
        remainderUnits: 36,
      });
    });
  });

  describe('setMinimumThreshold', () => {
    it("lève NotFoundException si aucun StockItem n'existe pour cet article", async () => {
      prisma.stockItem.findFirst.mockResolvedValue(null);

      await expect(
        service.setMinimumThreshold(siteId, flacon.id, 50),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.stockItem.update).not.toHaveBeenCalled();
    });

    it('met à jour le seuil minimum et recalcule isLowStock', async () => {
      prisma.stockItem.findFirst.mockResolvedValue({
        id: 'stock-item-1',
        siteId,
        articleId: flacon.id,
        availableQuantity: new Prisma.Decimal(30),
        minimumThreshold: null,
      });
      prisma.stockItem.update.mockResolvedValue({
        id: 'stock-item-1',
        siteId,
        articleId: flacon.id,
        article: flacon,
        availableQuantity: new Prisma.Decimal(30),
        minimumThreshold: new Prisma.Decimal(50),
      });

      const result = await service.setMinimumThreshold(siteId, flacon.id, 50);

      expect(prisma.stockItem.update).toHaveBeenCalledWith({
        where: { articleId: flacon.id },
        data: { minimumThreshold: 50 },
        include: { article: true },
      });
      expect(result.isLowStock).toBe(true);
      expect(result.cartonEquivalent).toEqual({
        fullCartons: 0,
        remainderUnits: 30,
      });
    });
  });
});
