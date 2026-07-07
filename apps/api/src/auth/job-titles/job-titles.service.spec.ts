import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JobTitlesService } from './job-titles.service';
import { PrismaService } from '../../prisma/prisma.service';
import { JobTitle, Prisma } from '../../../generated/prisma/client';

describe('JobTitlesService', () => {
  let service: JobTitlesService;
  let prisma: {
    jobTitle: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };

  const siteId = 'site-1';

  const jobTitle: JobTitle = {
    id: 'job-1',
    siteId,
    name: 'Responsable adjoint',
    active: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  const uniqueConstraintError = new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed',
    { code: 'P2002', clientVersion: '7.8.0' },
  );

  beforeEach(async () => {
    prisma = {
      jobTitle: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobTitlesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(JobTitlesService);
  });

  describe('create', () => {
    it('crée la fonction métier rattachée au site courant', async () => {
      prisma.jobTitle.create.mockResolvedValue(jobTitle);

      const result = await service.create(siteId, { name: jobTitle.name });

      expect(prisma.jobTitle.create).toHaveBeenCalledWith({
        data: { siteId, name: jobTitle.name },
      });
      expect(result).toEqual(jobTitle);
    });

    it('convertit une violation de contrainte unique en ConflictException explicite', async () => {
      prisma.jobTitle.create.mockRejectedValue(uniqueConstraintError);

      await expect(
        service.create(siteId, { name: 'Responsable adjoint' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('deactivate / reactivate', () => {
    it('désactive sans supprimer physiquement', async () => {
      prisma.jobTitle.findFirst.mockResolvedValue(jobTitle);
      prisma.jobTitle.update.mockResolvedValue({ ...jobTitle, active: false });

      const result = await service.deactivate(siteId, jobTitle.id);

      expect(prisma.jobTitle.update).toHaveBeenCalledWith({
        where: { id: jobTitle.id },
        data: { active: false },
      });
      expect(result.active).toBe(false);
    });

    it("lève NotFoundException si la fonction n'existe pas sur ce site", async () => {
      prisma.jobTitle.findFirst.mockResolvedValue(null);

      await expect(service.deactivate(siteId, 'inconnue')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('réactive une fonction désactivée', async () => {
      prisma.jobTitle.findFirst.mockResolvedValue({
        ...jobTitle,
        active: false,
      });
      prisma.jobTitle.update.mockResolvedValue({ ...jobTitle, active: true });

      const result = await service.reactivate(siteId, jobTitle.id);

      expect(result.active).toBe(true);
    });
  });
});
