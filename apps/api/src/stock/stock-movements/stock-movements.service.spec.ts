import { Test, TestingModule } from '@nestjs/testing';
import { StockMovementsService } from './stock-movements.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('StockMovementsService', () => {
  let service: StockMovementsService;
  let prisma: { stockMovement: { findMany: jest.Mock } };

  const siteId = 'site-1';
  const stockLotId = 'stock-lot-1';

  beforeEach(async () => {
    prisma = { stockMovement: { findMany: jest.fn() } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StockMovementsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(StockMovementsService);
  });

  it('liste les mouvements par site et par lot, du plus récent au plus ancien', async () => {
    prisma.stockMovement.findMany.mockResolvedValue([]);

    await service.findAllByStockLot(siteId, stockLotId);

    expect(prisma.stockMovement.findMany).toHaveBeenCalledWith({
      where: { siteId, stockLotId },
      orderBy: { movementDate: 'desc' },
    });
  });
});
