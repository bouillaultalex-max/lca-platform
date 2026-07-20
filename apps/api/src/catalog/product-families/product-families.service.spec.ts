import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ProductFamiliesService } from './product-families.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ProductFamily } from '../../../generated/prisma/client';

describe('ProductFamiliesService', () => {
  let service: ProductFamiliesService;
  let prisma: {
    productFamily: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };

  const siteId = 'site-1';

  const productFamily: ProductFamily = {
    id: 'product-family-1',
    siteId,
    name: 'Recharge Lavande',
    active: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  beforeEach(async () => {
    prisma = {
      productFamily: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductFamiliesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(ProductFamiliesService);
  });

  describe('findAll', () => {
    it('liste les familles commerciales du site', async () => {
      prisma.productFamily.findMany.mockResolvedValue([productFamily]);

      const result = await service.findAll(siteId);

      expect(prisma.productFamily.findMany).toHaveBeenCalledWith({
        where: { siteId },
        orderBy: { name: 'asc' },
      });
      expect(result).toEqual([productFamily]);
    });
  });

  describe('findOne', () => {
    it('retourne la famille commerciale si elle existe sur ce site', async () => {
      prisma.productFamily.findFirst.mockResolvedValue(productFamily);

      const result = await service.findOne(siteId, productFamily.id);

      expect(result).toEqual(productFamily);
    });

    it('lève NotFoundException si la famille commerciale est introuvable sur ce site', async () => {
      prisma.productFamily.findFirst.mockResolvedValue(null);

      await expect(service.findOne(siteId, 'inconnu')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('lève NotFoundException pour une famille commerciale existante mais rattachée à un autre site (sans révéler son existence)', async () => {
      // Le service interroge toujours findFirst({ id, siteId }) : une famille
      // d'un autre site ne peut jamais correspondre, quel que soit l'id fourni.
      prisma.productFamily.findFirst.mockResolvedValue(null);

      await expect(
        service.findOne(siteId, 'famille-autre-site'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.productFamily.findFirst).toHaveBeenCalledWith({
        where: { id: 'famille-autre-site', siteId },
      });
    });
  });

  describe('create', () => {
    it('crée la famille commerciale rattachée au site courant', async () => {
      prisma.productFamily.create.mockResolvedValue(productFamily);

      const dto = { name: 'Recharge Lavande' };

      const result = await service.create(siteId, dto);

      expect(prisma.productFamily.create).toHaveBeenCalledWith({
        data: { siteId, ...dto },
      });
      expect(result).toEqual(productFamily);
    });
  });

  describe('update', () => {
    it('met à jour la famille commerciale existante', async () => {
      prisma.productFamily.findFirst.mockResolvedValue(productFamily);
      prisma.productFamily.update.mockResolvedValue({
        ...productFamily,
        name: 'Recharge Lavande Premium',
      });

      const result = await service.update(siteId, productFamily.id, {
        name: 'Recharge Lavande Premium',
      });

      expect(prisma.productFamily.update).toHaveBeenCalledWith({
        where: { id: productFamily.id },
        data: { name: 'Recharge Lavande Premium' },
      });
      expect(result.name).toBe('Recharge Lavande Premium');
    });

    it("lève NotFoundException si la famille commerciale à mettre à jour n'existe pas sur ce site", async () => {
      prisma.productFamily.findFirst.mockResolvedValue(null);

      await expect(
        service.update(siteId, 'inconnu', { name: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deactivate', () => {
    it('désactive la famille commerciale (active: false) sans la supprimer', async () => {
      prisma.productFamily.findFirst.mockResolvedValue(productFamily);
      prisma.productFamily.update.mockResolvedValue({
        ...productFamily,
        active: false,
      });

      const result = await service.deactivate(siteId, productFamily.id);

      expect(prisma.productFamily.update).toHaveBeenCalledWith({
        where: { id: productFamily.id },
        data: { active: false },
      });
      expect(result.active).toBe(false);
    });

    it("lève NotFoundException si la famille commerciale à désactiver n'existe pas sur ce site", async () => {
      prisma.productFamily.findFirst.mockResolvedValue(null);

      await expect(service.deactivate(siteId, 'inconnu')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
