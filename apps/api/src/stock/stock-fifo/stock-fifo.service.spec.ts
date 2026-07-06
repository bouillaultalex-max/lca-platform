import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { computeFifoAllocations, StockFifoService } from './stock-fifo.service';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';

describe('StockFifoService', () => {
  let service: StockFifoService;
  let prisma: { stockLot: { findMany: jest.Mock } };

  const siteId = 'site-1';
  const articleId = 'article-1';

  const lot = (id: string, receivedAt: string, remainingQuantity: number) => ({
    id,
    siteId,
    articleId,
    supplierLotNumber: `LOT-${id}`,
    receivedQuantity: new Prisma.Decimal(remainingQuantity),
    remainingQuantity: new Prisma.Decimal(remainingQuantity),
    receivedAt: new Date(receivedAt),
    expiryDate: null,
  });

  // Simplifie les assertions : les Decimal ne sont pas directement comparables avec toEqual.
  const toPlain = (
    allocations: Awaited<ReturnType<StockFifoService['allocate']>>,
  ) =>
    allocations.map((a) => ({
      stockLotId: a.stockLotId,
      quantityToConsume: a.quantityToConsume.toString(),
    }));

  beforeEach(async () => {
    prisma = { stockLot: { findMany: jest.fn() } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StockFifoService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(StockFifoService);
  });

  it('interroge Prisma en excluant les lots à quantité disponible nulle, triés du plus ancien au plus récent', async () => {
    prisma.stockLot.findMany.mockResolvedValue([]);

    await expect(service.allocate(siteId, articleId, 1)).rejects.toThrow(
      BadRequestException,
    );

    expect(prisma.stockLot.findMany).toHaveBeenCalledWith({
      where: { siteId, articleId, remainingQuantity: { gt: 0 } },
      orderBy: { receivedAt: 'asc' },
    });
  });

  it('rejette une quantité demandée nulle ou négative sans interroger la base', async () => {
    await expect(service.allocate(siteId, articleId, 0)).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.allocate(siteId, articleId, -5)).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.stockLot.findMany).not.toHaveBeenCalled();
  });

  it('consomme un seul lot quand il couvre entièrement le besoin', async () => {
    prisma.stockLot.findMany.mockResolvedValue([lot('A', '2026-01-01', 100)]);

    const result = await service.allocate(siteId, articleId, 40);

    expect(toPlain(result)).toEqual([
      { stockLotId: 'A', quantityToConsume: '40' },
    ]);
  });

  it('consomme un lot exactement jusqu’à épuisement quand le besoin est égal à la quantité restante', async () => {
    prisma.stockLot.findMany.mockResolvedValue([lot('A', '2026-01-01', 40)]);

    const result = await service.allocate(siteId, articleId, 40);

    expect(toPlain(result)).toEqual([
      { stockLotId: 'A', quantityToConsume: '40' },
    ]);
  });

  it('répartit sur plusieurs lots dans l’ordre FIFO (le plus ancien reçu en premier)', async () => {
    prisma.stockLot.findMany.mockResolvedValue([
      lot('A', '2026-01-01', 30), // le plus ancien, renvoyé en premier par la requête triée
      lot('B', '2026-02-01', 50),
      lot('C', '2026-03-01', 100),
    ]);

    const result = await service.allocate(siteId, articleId, 90);

    expect(toPlain(result)).toEqual([
      { stockLotId: 'A', quantityToConsume: '30' },
      { stockLotId: 'B', quantityToConsume: '50' },
      { stockLotId: 'C', quantityToConsume: '10' },
    ]);
  });

  it('n’inclut pas les lots suivants une fois le besoin couvert', async () => {
    prisma.stockLot.findMany.mockResolvedValue([
      lot('A', '2026-01-01', 100),
      lot('B', '2026-02-01', 100),
    ]);

    const result = await service.allocate(siteId, articleId, 60);

    expect(toPlain(result)).toEqual([
      { stockLotId: 'A', quantityToConsume: '60' },
    ]);
  });

  it('lève une exception si le stock total (tous lots confondus) est insuffisant, sans allocation partielle', async () => {
    prisma.stockLot.findMany.mockResolvedValue([
      lot('A', '2026-01-01', 30),
      lot('B', '2026-02-01', 20),
    ]);

    await expect(service.allocate(siteId, articleId, 100)).rejects.toThrow(
      "Stock insuffisant pour l'article article-1 : 50 unité(s) manquante(s).",
    );
  });

  it('lève une exception si aucun lot disponible (tous à zéro, déjà filtrés par la requête)', async () => {
    prisma.stockLot.findMany.mockResolvedValue([]);

    await expect(service.allocate(siteId, articleId, 10)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('accepte une quantité demandée exprimée en Decimal', async () => {
    prisma.stockLot.findMany.mockResolvedValue([lot('A', '2026-01-01', 100)]);

    const result = await service.allocate(
      siteId,
      articleId,
      new Prisma.Decimal('25.5'),
    );

    expect(toPlain(result)).toEqual([
      { stockLotId: 'A', quantityToConsume: '25.5' },
    ]);
  });
});

/**
 * Tests de non-régression pour la fonction pure extraite de StockFifoService,
 * réutilisée directement (avec des lots chargés via un client transactionnel `tx`)
 * par la clôture de batch (module `production`) — voir docs/regles-metier.md §12.
 */
describe('computeFifoAllocations (fonction pure)', () => {
  const plainLot = (id: string, remainingQuantity: number) => ({
    id,
    remainingQuantity: new Prisma.Decimal(remainingQuantity),
  });

  it('retourne un shortfall à 0 quand un seul lot couvre entièrement le besoin', () => {
    const result = computeFifoAllocations(
      [plainLot('A', 100)],
      new Prisma.Decimal(40),
    );

    expect(
      result.allocations.map((a) => ({
        stockLotId: a.stockLotId,
        quantityToConsume: a.quantityToConsume.toString(),
      })),
    ).toEqual([{ stockLotId: 'A', quantityToConsume: '40' }]);
    expect(result.shortfall.toString()).toBe('0');
  });

  it('répartit sur plusieurs lots et retourne un shortfall à 0 quand le total suffit', () => {
    const result = computeFifoAllocations(
      [plainLot('A', 30), plainLot('B', 50)],
      new Prisma.Decimal(70),
    );

    expect(
      result.allocations.map((a) => a.quantityToConsume.toString()),
    ).toEqual(['30', '40']);
    expect(result.shortfall.toString()).toBe('0');
  });

  it('retourne un shortfall positif (et les allocations partielles) quand le stock total est insuffisant', () => {
    const result = computeFifoAllocations(
      [plainLot('A', 30), plainLot('B', 20)],
      new Prisma.Decimal(100),
    );

    expect(
      result.allocations.map((a) => a.quantityToConsume.toString()),
    ).toEqual(['30', '20']);
    expect(result.shortfall.toString()).toBe('50');
  });

  it('retourne un shortfall égal au besoin complet quand aucun lot n’est disponible', () => {
    const result = computeFifoAllocations([], new Prisma.Decimal(10));

    expect(result.allocations).toEqual([]);
    expect(result.shortfall.toString()).toBe('10');
  });
});
