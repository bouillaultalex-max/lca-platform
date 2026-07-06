import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MachinesService } from './machines.service';
import { PrismaService } from '../../prisma/prisma.service';
import { Machine } from '../../../generated/prisma/client';

describe('MachinesService', () => {
  let service: MachinesService;
  let prisma: {
    machine: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };

  const siteId = 'site-1';

  const machine: Machine = {
    id: 'machine-1',
    siteId,
    name: 'CDA E-Fill 1',
    supportedFormats: [50, 100, 200],
    active: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  beforeEach(async () => {
    prisma = {
      machine: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MachinesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(MachinesService);
  });

  describe('findAll', () => {
    it('liste les machines du site', async () => {
      prisma.machine.findMany.mockResolvedValue([machine]);

      const result = await service.findAll(siteId);

      expect(prisma.machine.findMany).toHaveBeenCalledWith({
        where: { siteId },
        orderBy: { name: 'asc' },
      });
      expect(result).toEqual([machine]);
    });
  });

  describe('findOne', () => {
    it('retourne la machine si elle existe sur ce site', async () => {
      prisma.machine.findFirst.mockResolvedValue(machine);

      const result = await service.findOne(siteId, machine.id);

      expect(result).toEqual(machine);
    });

    it('lève NotFoundException si la machine est introuvable sur ce site', async () => {
      prisma.machine.findFirst.mockResolvedValue(null);

      await expect(service.findOne(siteId, 'inconnue')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('crée la machine rattachée au site courant', async () => {
      prisma.machine.create.mockResolvedValue(machine);

      const dto = { name: 'CDA E-Fill 1', supportedFormats: [50, 100, 200] };

      const result = await service.create(siteId, dto);

      expect(prisma.machine.create).toHaveBeenCalledWith({
        data: { siteId, ...dto },
      });
      expect(result).toEqual(machine);
    });
  });

  describe('deactivate', () => {
    it('désactive la machine (active: false) sans la supprimer', async () => {
      prisma.machine.findFirst.mockResolvedValue(machine);
      prisma.machine.update.mockResolvedValue({ ...machine, active: false });

      const result = await service.deactivate(siteId, machine.id);

      expect(prisma.machine.update).toHaveBeenCalledWith({
        where: { id: machine.id },
        data: { active: false },
      });
      expect(result.active).toBe(false);
    });

    it("lève NotFoundException si la machine à désactiver n'existe pas sur ce site", async () => {
      prisma.machine.findFirst.mockResolvedValue(null);

      await expect(service.deactivate(siteId, 'inconnue')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
