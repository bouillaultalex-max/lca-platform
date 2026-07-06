import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { BatchesService } from './batches.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BatchStatus, RecipeStatus } from '../../../generated/prisma/client';

describe('BatchesService', () => {
  let service: BatchesService;
  let prisma: {
    recipe: { findFirst: jest.Mock };
    machine: { findFirst: jest.Mock };
    batch: { findMany: jest.Mock; findFirst: jest.Mock; create: jest.Mock };
  };

  const siteId = 'site-1';
  const userId = 'user-1';

  const activeRecipe = {
    id: 'recipe-1',
    siteId,
    format: 100,
    status: RecipeStatus.ACTIVE,
  };

  const activeMachine = {
    id: 'machine-1',
    siteId,
    name: 'CDA E-Fill 1',
    supportedFormats: [50, 100, 200],
    active: true,
  };

  const dto = {
    recipeId: activeRecipe.id,
    machineId: activeMachine.id,
    plannedQuantity: 500,
  };

  beforeEach(async () => {
    prisma = {
      recipe: { findFirst: jest.fn() },
      machine: { findFirst: jest.fn() },
      batch: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [BatchesService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(BatchesService);
  });

  describe('create', () => {
    it('crée le batch avec le format hérité de la recette', async () => {
      prisma.recipe.findFirst.mockResolvedValue(activeRecipe);
      prisma.machine.findFirst.mockResolvedValue(activeMachine);
      prisma.batch.create.mockResolvedValue({ id: 'batch-1' });

      await service.create(siteId, userId, dto);

      expect(prisma.batch.create).toHaveBeenCalledWith({
        data: {
          siteId,
          recipeId: dto.recipeId,
          machineId: dto.machineId,
          format: activeRecipe.format,
          plannedQuantity: dto.plannedQuantity,
          status: BatchStatus.PLANIFIE,
          createdByUserId: userId,
        },
      });
    });

    it('lève NotFoundException si la recette est introuvable sur ce site', async () => {
      prisma.recipe.findFirst.mockResolvedValue(null);

      await expect(service.create(siteId, userId, dto)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.batch.create).not.toHaveBeenCalled();
    });

    it('rejette une recette archivée', async () => {
      prisma.recipe.findFirst.mockResolvedValue({
        ...activeRecipe,
        status: RecipeStatus.ARCHIVEE,
      });

      await expect(service.create(siteId, userId, dto)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.batch.create).not.toHaveBeenCalled();
    });

    it('lève NotFoundException si la machine est introuvable sur ce site', async () => {
      prisma.recipe.findFirst.mockResolvedValue(activeRecipe);
      prisma.machine.findFirst.mockResolvedValue(null);

      await expect(service.create(siteId, userId, dto)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.batch.create).not.toHaveBeenCalled();
    });

    it('rejette une machine désactivée', async () => {
      prisma.recipe.findFirst.mockResolvedValue(activeRecipe);
      prisma.machine.findFirst.mockResolvedValue({
        ...activeMachine,
        active: false,
      });

      await expect(service.create(siteId, userId, dto)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.batch.create).not.toHaveBeenCalled();
    });

    it('rejette une machine qui ne supporte pas le format de la recette', async () => {
      prisma.recipe.findFirst.mockResolvedValue(activeRecipe);
      prisma.machine.findFirst.mockResolvedValue({
        ...activeMachine,
        supportedFormats: [50, 200],
      });

      await expect(service.create(siteId, userId, dto)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.batch.create).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('lève NotFoundException si le batch est introuvable sur ce site', async () => {
      prisma.batch.findFirst.mockResolvedValue(null);

      await expect(service.findOne(siteId, 'inconnu')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findAll', () => {
    it('liste les batches du site, du plus récent au plus ancien', async () => {
      prisma.batch.findMany.mockResolvedValue([]);

      await service.findAll(siteId);

      expect(prisma.batch.findMany).toHaveBeenCalledWith({
        where: { siteId },
        orderBy: { createdAt: 'desc' },
      });
    });
  });
});
