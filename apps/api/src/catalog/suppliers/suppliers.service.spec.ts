import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SuppliersService } from './suppliers.service';
import { PrismaService } from '../../prisma/prisma.service';
import { Supplier } from '../../../generated/prisma/client';

describe('SuppliersService', () => {
  let service: SuppliersService;
  let prisma: {
    supplier: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };

  const siteId = 'site-1';

  const supplier: Supplier = {
    id: 'supplier-1',
    siteId,
    name: 'Sensient Flavors',
    contactName: 'Marie Dupont',
    phone: '+33 1 23 45 67 89',
    email: 'contact@sensient-flavors.com',
    active: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  beforeEach(async () => {
    prisma = {
      supplier: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SuppliersService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(SuppliersService);
  });

  describe('findAll', () => {
    it('liste les fournisseurs du site', async () => {
      prisma.supplier.findMany.mockResolvedValue([supplier]);

      const result = await service.findAll(siteId);

      expect(prisma.supplier.findMany).toHaveBeenCalledWith({
        where: { siteId },
        orderBy: { name: 'asc' },
      });
      expect(result).toEqual([supplier]);
    });
  });

  describe('findOne', () => {
    it('retourne le fournisseur si il existe sur ce site', async () => {
      prisma.supplier.findFirst.mockResolvedValue(supplier);

      const result = await service.findOne(siteId, supplier.id);

      expect(result).toEqual(supplier);
    });

    it('lève NotFoundException si le fournisseur est introuvable sur ce site', async () => {
      prisma.supplier.findFirst.mockResolvedValue(null);

      await expect(service.findOne(siteId, 'inconnu')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('crée le fournisseur rattaché au site courant', async () => {
      prisma.supplier.create.mockResolvedValue(supplier);

      const dto = { name: 'Sensient Flavors', contactName: 'Marie Dupont' };

      const result = await service.create(siteId, dto);

      expect(prisma.supplier.create).toHaveBeenCalledWith({
        data: { siteId, ...dto },
      });
      expect(result).toEqual(supplier);
    });
  });

  describe('update', () => {
    it('met à jour le fournisseur existant', async () => {
      prisma.supplier.findFirst.mockResolvedValue(supplier);
      prisma.supplier.update.mockResolvedValue({
        ...supplier,
        phone: '+33 6 00 00 00 00',
      });

      const result = await service.update(siteId, supplier.id, {
        phone: '+33 6 00 00 00 00',
      });

      expect(prisma.supplier.update).toHaveBeenCalledWith({
        where: { id: supplier.id },
        data: { phone: '+33 6 00 00 00 00' },
      });
      expect(result.phone).toBe('+33 6 00 00 00 00');
    });

    it("lève NotFoundException si le fournisseur à mettre à jour n'existe pas sur ce site", async () => {
      prisma.supplier.findFirst.mockResolvedValue(null);

      await expect(
        service.update(siteId, 'inconnu', { name: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deactivate', () => {
    it('désactive le fournisseur (active: false) sans le supprimer', async () => {
      prisma.supplier.findFirst.mockResolvedValue(supplier);
      prisma.supplier.update.mockResolvedValue({ ...supplier, active: false });

      const result = await service.deactivate(siteId, supplier.id);

      expect(prisma.supplier.update).toHaveBeenCalledWith({
        where: { id: supplier.id },
        data: { active: false },
      });
      expect(result.active).toBe(false);
    });

    it("lève NotFoundException si le fournisseur à désactiver n'existe pas sur ce site", async () => {
      prisma.supplier.findFirst.mockResolvedValue(null);

      await expect(service.deactivate(siteId, 'inconnu')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
