import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { StockLotsService } from './stock-lots.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  Article,
  ArticleType,
  Prisma,
  StockMovementType,
} from '../../../generated/prisma/client';

describe('StockLotsService', () => {
  let service: StockLotsService;
  let prisma: {
    article: { findFirst: jest.Mock };
    stockLot: { findFirst: jest.Mock; findMany: jest.Mock };
    $transaction: jest.Mock<Promise<unknown>, [(tx: unknown) => unknown]>;
  };
  let tx: {
    stockLot: {
      create: jest.Mock<Promise<unknown>, [Record<string, unknown>]>;
      update: jest.Mock<Promise<unknown>, [Record<string, unknown>]>;
    };
    stockMovement: {
      create: jest.Mock<Promise<unknown>, [Record<string, unknown>]>;
    };
    stockItem: {
      upsert: jest.Mock<Promise<unknown>, [Record<string, unknown>]>;
    };
  };

  const siteId = 'site-1';
  const userId = 'user-1';

  const article: Article = {
    id: 'article-1',
    siteId,
    type: ArticleType.MATIERE_PREMIERE,
    openSiReference: 'MP-LAVANDE',
    name: 'Parfum ambiance lavande (vrac)',
    unitOfMeasure: 'L',
    currentUnitCost: new Prisma.Decimal(12.5),
    unitsPerCarton: null,
    active: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  const dto = {
    articleId: article.id,
    supplierLotNumber: 'LOT-FOURNISSEUR-001',
    receivedQuantity: 200,
    receivedAt: '2026-07-06',
  };

  beforeEach(async () => {
    tx = {
      stockLot: {
        create: jest.fn<Promise<unknown>, [Record<string, unknown>]>(),
        update: jest.fn<Promise<unknown>, [Record<string, unknown>]>(),
      },
      stockMovement: {
        create: jest.fn<Promise<unknown>, [Record<string, unknown>]>(),
      },
      stockItem: {
        upsert: jest.fn<Promise<unknown>, [Record<string, unknown>]>(),
      },
    };
    prisma = {
      article: { findFirst: jest.fn() },
      stockLot: { findFirst: jest.fn(), findMany: jest.fn() },
      $transaction: jest.fn<Promise<unknown>, [(tx: unknown) => unknown]>(
        (callback) => Promise.resolve(callback(tx)),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StockLotsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(StockLotsService);
  });

  describe('findAllByArticle', () => {
    it('liste les lots par site et par article, du plus ancien reçu au plus récent', async () => {
      prisma.stockLot.findMany.mockResolvedValue([]);

      await service.findAllByArticle(siteId, article.id);

      expect(prisma.stockLot.findMany).toHaveBeenCalledWith({
        where: { siteId, articleId: article.id },
        orderBy: { receivedAt: 'asc' },
      });
    });
  });

  it("lève NotFoundException si l'article est introuvable sur ce site", async () => {
    prisma.article.findFirst.mockResolvedValue(null);

    await expect(service.receive(siteId, userId, dto)).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('crée le StockLot, le StockMovement ENTREE associé, et incrémente le StockItem', async () => {
    prisma.article.findFirst.mockResolvedValue(article);
    const createdStockLot = {
      id: 'stock-lot-1',
      ...dto,
      remainingQuantity: dto.receivedQuantity,
    };
    tx.stockLot.create.mockResolvedValue(createdStockLot);

    const result = await service.receive(siteId, userId, dto);

    expect(tx.stockLot.create).toHaveBeenCalledWith({
      data: {
        siteId,
        articleId: dto.articleId,
        supplierLotNumber: dto.supplierLotNumber,
        receivedQuantity: dto.receivedQuantity,
        remainingQuantity: dto.receivedQuantity,
        receivedAt: new Date(dto.receivedAt),
        expiryDate: null,
      },
    });

    expect(tx.stockMovement.create).toHaveBeenCalledWith({
      data: {
        siteId,
        articleId: dto.articleId,
        stockLotId: createdStockLot.id,
        type: StockMovementType.ENTREE,
        quantity: dto.receivedQuantity,
        userId,
        comment: undefined,
      },
    });

    expect(tx.stockItem.upsert).toHaveBeenCalledWith({
      where: { articleId: dto.articleId },
      update: { availableQuantity: { increment: dto.receivedQuantity } },
      create: {
        siteId,
        articleId: dto.articleId,
        availableQuantity: dto.receivedQuantity,
      },
    });

    expect(result).toEqual(createdStockLot);
  });

  it('convertit expiryDate en Date quand fourni', async () => {
    prisma.article.findFirst.mockResolvedValue(article);
    tx.stockLot.create.mockResolvedValue({ id: 'stock-lot-1' });

    await service.receive(siteId, userId, { ...dto, expiryDate: '2027-07-06' });

    const createArgs = tx.stockLot.create.mock.calls[0][0] as {
      data: { expiryDate: Date | null };
    };
    expect(createArgs.data.expiryDate).toEqual(new Date('2027-07-06'));
  });

  describe('receive avec un client transactionnel externe', () => {
    let externalClient: {
      article: { findFirst: jest.Mock };
      stockLot: {
        create: jest.Mock<Promise<unknown>, [Record<string, unknown>]>;
      };
      stockMovement: {
        create: jest.Mock<Promise<unknown>, [Record<string, unknown>]>;
      };
      stockItem: {
        upsert: jest.Mock<Promise<unknown>, [Record<string, unknown>]>;
      };
    };

    beforeEach(() => {
      externalClient = {
        article: { findFirst: jest.fn() },
        stockLot: {
          create: jest.fn<Promise<unknown>, [Record<string, unknown>]>(),
        },
        stockMovement: {
          create: jest.fn<Promise<unknown>, [Record<string, unknown>]>(),
        },
        stockItem: {
          upsert: jest.fn<Promise<unknown>, [Record<string, unknown>]>(),
        },
      };
    });

    it('écrit directement via le client fourni, sans ouvrir une nouvelle transaction', async () => {
      externalClient.article.findFirst.mockResolvedValue(article);
      const createdStockLot = {
        id: 'stock-lot-1',
        ...dto,
        remainingQuantity: dto.receivedQuantity,
      };
      externalClient.stockLot.create.mockResolvedValue(createdStockLot);

      const result = await service.receive(siteId, userId, dto, externalClient);

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(externalClient.stockLot.create).toHaveBeenCalledWith({
        data: {
          siteId,
          articleId: dto.articleId,
          supplierLotNumber: dto.supplierLotNumber,
          receivedQuantity: dto.receivedQuantity,
          remainingQuantity: dto.receivedQuantity,
          receivedAt: new Date(dto.receivedAt),
          expiryDate: null,
        },
      });
      expect(externalClient.stockMovement.create).toHaveBeenCalledWith({
        data: {
          siteId,
          articleId: dto.articleId,
          stockLotId: createdStockLot.id,
          type: StockMovementType.ENTREE,
          quantity: dto.receivedQuantity,
          userId,
          comment: undefined,
        },
      });
      expect(externalClient.stockItem.upsert).toHaveBeenCalledWith({
        where: { articleId: dto.articleId },
        update: { availableQuantity: { increment: dto.receivedQuantity } },
        create: {
          siteId,
          articleId: dto.articleId,
          availableQuantity: dto.receivedQuantity,
        },
      });
      expect(result).toEqual(createdStockLot);

      // Les mocks de la transaction "par défaut" ne doivent jamais être sollicités.
      expect(tx.stockLot.create).not.toHaveBeenCalled();
      expect(tx.stockMovement.create).not.toHaveBeenCalled();
      expect(tx.stockItem.upsert).not.toHaveBeenCalled();
    });

    it('lève NotFoundException via le client fourni sans jamais ouvrir de transaction', async () => {
      externalClient.article.findFirst.mockResolvedValue(null);

      await expect(
        service.receive(siteId, userId, dto, externalClient),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(externalClient.stockLot.create).not.toHaveBeenCalled();
    });
  });

  describe('adjust', () => {
    const existingStockLot = {
      id: 'stock-lot-1',
      siteId,
      articleId: article.id,
      supplierLotNumber: 'LOT-FOURNISSEUR-001',
      receivedQuantity: new Prisma.Decimal(200),
      remainingQuantity: new Prisma.Decimal(150),
      receivedAt: new Date('2026-07-01'),
      expiryDate: null,
    };

    it('lève NotFoundException si le lot est introuvable sur ce site', async () => {
      prisma.stockLot.findFirst.mockResolvedValue(null);

      await expect(
        service.adjust(siteId, userId, 'inconnu', { countedQuantity: 100 }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('journalise un StockMovement AJUSTEMENT_INVENTAIRE avec le delta signé (écart négatif)', async () => {
      prisma.stockLot.findFirst.mockResolvedValue(existingStockLot);
      tx.stockLot.update.mockResolvedValue({
        ...existingStockLot,
        remainingQuantity: new Prisma.Decimal(130),
      });

      await service.adjust(siteId, userId, existingStockLot.id, {
        countedQuantity: 130,
        comment: 'Écart inventaire',
      });

      expect(tx.stockLot.update).toHaveBeenCalledWith({
        where: { id: existingStockLot.id },
        data: { remainingQuantity: 130 },
      });

      const movementArgs = tx.stockMovement.create.mock.calls[0][0] as {
        data: {
          type: string;
          quantity: Prisma.Decimal;
          comment?: string;
          stockLotId: string;
          articleId: string;
        };
      };
      expect(movementArgs.data.type).toBe(
        StockMovementType.AJUSTEMENT_INVENTAIRE,
      );
      expect(movementArgs.data.quantity.toString()).toBe('-20');
      expect(movementArgs.data.stockLotId).toBe(existingStockLot.id);
      expect(movementArgs.data.articleId).toBe(article.id);
      expect(movementArgs.data.comment).toBe('Écart inventaire');

      const stockItemArgs = tx.stockItem.upsert.mock.calls[0][0] as {
        update: { availableQuantity: { increment: Prisma.Decimal } };
      };
      expect(stockItemArgs.update.availableQuantity.increment.toString()).toBe(
        '-20',
      );
    });

    it('journalise un delta positif quand la quantité constatée est supérieure au système', async () => {
      prisma.stockLot.findFirst.mockResolvedValue(existingStockLot);
      tx.stockLot.update.mockResolvedValue({
        ...existingStockLot,
        remainingQuantity: new Prisma.Decimal(160),
      });

      await service.adjust(siteId, userId, existingStockLot.id, {
        countedQuantity: 160,
      });

      const movementArgs = tx.stockMovement.create.mock.calls[0][0] as {
        data: { quantity: Prisma.Decimal };
      };
      expect(movementArgs.data.quantity.toString()).toBe('10');
    });

    it('journalise un delta nul quand la quantité constatée confirme le système (traçabilité de la vérification)', async () => {
      prisma.stockLot.findFirst.mockResolvedValue(existingStockLot);
      tx.stockLot.update.mockResolvedValue(existingStockLot);

      await service.adjust(siteId, userId, existingStockLot.id, {
        countedQuantity: 150,
      });

      const movementArgs = tx.stockMovement.create.mock.calls[0][0] as {
        data: { quantity: Prisma.Decimal };
      };
      expect(movementArgs.data.quantity.toString()).toBe('0');
      expect(tx.stockMovement.create).toHaveBeenCalledTimes(1);
    });
  });
});
