import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MarketsService } from './markets.service';
import { PrismaService } from '../../prisma/prisma.service';
import { Market } from '../../../generated/prisma/client';

describe('MarketsService', () => {
  let service: MarketsService;
  let prisma: {
    market: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };

  const siteId = 'site-1';

  const market: Market = {
    id: 'market-1',
    siteId,
    code: 'FR',
    label: 'France',
    active: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  beforeEach(async () => {
    prisma = {
      market: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [MarketsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(MarketsService);
  });

  describe('findAll', () => {
    it('liste les marchés du site', async () => {
      prisma.market.findMany.mockResolvedValue([market]);

      const result = await service.findAll(siteId);

      expect(prisma.market.findMany).toHaveBeenCalledWith({
        where: { siteId },
        orderBy: { code: 'asc' },
      });
      expect(result).toEqual([market]);
    });
  });

  describe('findOne', () => {
    it('retourne le marché si il existe sur ce site', async () => {
      prisma.market.findFirst.mockResolvedValue(market);

      const result = await service.findOne(siteId, market.id);

      expect(result).toEqual(market);
    });

    it('lève NotFoundException si le marché est introuvable sur ce site', async () => {
      prisma.market.findFirst.mockResolvedValue(null);

      await expect(service.findOne(siteId, 'inconnu')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('lève NotFoundException pour un marché existant mais rattaché à un autre site (sans révéler son existence)', async () => {
      // Le service interroge toujours findFirst({ id, siteId }) : un marché d'un
      // autre site ne peut jamais correspondre, quel que soit l'id fourni.
      prisma.market.findFirst.mockResolvedValue(null);

      await expect(
        service.findOne(siteId, 'market-autre-site'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.market.findFirst).toHaveBeenCalledWith({
        where: { id: 'market-autre-site', siteId },
      });
    });
  });

  describe('create', () => {
    it('crée le marché rattaché au site courant', async () => {
      prisma.market.create.mockResolvedValue(market);

      const dto = { code: 'FR', label: 'France' };

      const result = await service.create(siteId, dto);

      expect(prisma.market.create).toHaveBeenCalledWith({
        data: { siteId, ...dto },
      });
      expect(result).toEqual(market);
    });
  });

  describe('update', () => {
    it('met à jour le marché existant', async () => {
      prisma.market.findFirst.mockResolvedValue(market);
      prisma.market.update.mockResolvedValue({
        ...market,
        label: 'France métropolitaine',
      });

      const result = await service.update(siteId, market.id, {
        label: 'France métropolitaine',
      });

      expect(prisma.market.update).toHaveBeenCalledWith({
        where: { id: market.id },
        data: { label: 'France métropolitaine' },
      });
      expect(result.label).toBe('France métropolitaine');
    });

    it("lève NotFoundException si le marché à mettre à jour n'existe pas sur ce site", async () => {
      prisma.market.findFirst.mockResolvedValue(null);

      await expect(
        service.update(siteId, 'inconnu', { code: 'CH' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deactivate', () => {
    it('désactive le marché (active: false) sans le supprimer', async () => {
      prisma.market.findFirst.mockResolvedValue(market);
      prisma.market.update.mockResolvedValue({ ...market, active: false });

      const result = await service.deactivate(siteId, market.id);

      expect(prisma.market.update).toHaveBeenCalledWith({
        where: { id: market.id },
        data: { active: false },
      });
      expect(result.active).toBe(false);
    });

    it("lève NotFoundException si le marché à désactiver n'existe pas sur ce site", async () => {
      prisma.market.findFirst.mockResolvedValue(null);

      await expect(service.deactivate(siteId, 'inconnu')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
