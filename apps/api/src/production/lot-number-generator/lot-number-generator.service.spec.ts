import { Test, TestingModule } from '@nestjs/testing';
import { LotNumberGeneratorService } from './lot-number-generator.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('LotNumberGeneratorService', () => {
  let service: LotNumberGeneratorService;
  let prisma: { lot: { count: jest.Mock } };

  const siteId = 'site-1';

  beforeEach(async () => {
    prisma = { lot: { count: jest.fn() } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LotNumberGeneratorService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(LotNumberGeneratorService);
  });

  it('génère 455001 pour le premier lot du site', async () => {
    prisma.lot.count.mockResolvedValue(0);

    const lotNumber = await service.generate(siteId);

    expect(lotNumber).toBe('455001');
    expect(prisma.lot.count).toHaveBeenCalledWith({ where: { siteId } });
  });

  it('incrémente correctement à partir du nombre de lots déjà existants', async () => {
    prisma.lot.count.mockResolvedValue(41);

    const lotNumber = await service.generate(siteId);

    expect(lotNumber).toBe('455042');
  });

  it('utilise le client fourni (ex : client transactionnel) au lieu de PrismaService par défaut', async () => {
    const txClient = { lot: { count: jest.fn().mockResolvedValue(9) } };

    const lotNumber = await service.generate(siteId, txClient);

    expect(lotNumber).toBe('455010');
    expect(prisma.lot.count).not.toHaveBeenCalled();
    expect(txClient.lot.count).toHaveBeenCalledWith({ where: { siteId } });
  });
});
