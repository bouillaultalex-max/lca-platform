import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { BatchPrintService } from './batch-print.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BatchPreparationService } from '../../batching/batch-preparation/batch-preparation.service';
import { BatchStatus } from '../../../generated/prisma/client';

describe('BatchPrintService (ADR 0010 § Décisions 16/17)', () => {
  let service: BatchPrintService;
  // Volontairement sans `lot: {...}` : prouve structurellement que ce service ne
  // requête jamais `Lot` (voir § Décision 11 « LOT NUMBER = Batch.reservedLotNumber,
  // jamais Lot.lotNumber ») — un appel accidentel à `prisma.lot.xxx` lèverait une
  // TypeError immédiate dans les tests ci-dessous.
  let prisma: { batch: { findFirst: jest.Mock } };
  let batchPreparationService: { computeIngredientQuantities: jest.Mock };

  const siteId = 'site-1';
  const batchId = 'batch-1';
  const reservedExpiryDate = new Date('2029-08-24T00:00:00.000Z');

  const baseBatch = {
    id: batchId,
    siteId,
    recipeId: 'recipe-1',
    plannedQuantity: 500,
    status: BatchStatus.EN_COURS,
    reservedLotNumber: '456149',
    reservedExpiryDate,
    recipe: { finishedProduct: { name: 'Produit de référence' } },
    allocations: [] as unknown[],
  };

  const allocationA = {
    id: 'alloc-A',
    recipeId: 'recipe-A',
    plannedQuantity: 300,
    product: { name: 'Produit A' },
  };
  const allocationB = {
    id: 'alloc-B',
    recipeId: 'recipe-B',
    plannedQuantity: 150,
    product: { name: 'Produit B' },
  };

  const pgLine = {
    kind: 'MATIERE_PREMIERE' as const,
    articleId: 'art-pg',
    articleName: 'Monopropylène glycol (PG)',
    articleReference: 'PG-001',
    volumeL: 12.5,
    massKg: 15.6,
  };
  const vgLine = {
    kind: 'MATIERE_PREMIERE' as const,
    articleId: 'art-vg',
    articleName: 'Glycérine végétale (VG)',
    articleReference: 'VG-001',
    volumeL: 37.5,
    massKg: 47.8,
  };
  const packagingLine = {
    kind: 'PACKAGING' as const,
    articleId: 'art-flacon',
    articleName: 'Flacon 100 ml',
    articleReference: 'FLA-100',
    quantity: 500,
    unit: 'unité',
  };

  beforeEach(async () => {
    prisma = { batch: { findFirst: jest.fn() } };
    batchPreparationService = { computeIngredientQuantities: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BatchPrintService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: BatchPreparationService,
          useValue: batchPreparationService,
        },
      ],
    }).compile();

    service = module.get(BatchPrintService);
  });

  it('lève NotFoundException si le batch est introuvable sur ce site (autre site ou id inconnu)', async () => {
    prisma.batch.findFirst.mockResolvedValue(null);

    await expect(service.getPrintData(siteId, batchId)).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.batch.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: batchId, siteId } }),
    );
  });

  it.each([BatchStatus.PLANIFIE, BatchStatus.ANNULE, BatchStatus.TERMINE])(
    'refuse explicitement un batch %s',
    async (status) => {
      prisma.batch.findFirst.mockResolvedValue({ ...baseBatch, status });

      await expect(service.getPrintData(siteId, batchId)).rejects.toThrow(
        BadRequestException,
      );
      expect(batchPreparationService.computeIngredientQuantities).not.toHaveBeenCalled();
    },
  );

  it('refuse explicitement si reservedLotNumber est NULL alors que reservedExpiryDate est renseignée (état incohérent)', async () => {
    prisma.batch.findFirst.mockResolvedValue({
      ...baseBatch,
      reservedLotNumber: null,
    });

    await expect(service.getPrintData(siteId, batchId)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('refuse explicitement si reservedExpiryDate est NULL alors que reservedLotNumber est renseigné (état incohérent)', async () => {
    prisma.batch.findFirst.mockResolvedValue({
      ...baseBatch,
      reservedExpiryDate: null,
    });

    await expect(service.getPrintData(siteId, batchId)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('refuse explicitement le repli legacy (EN_COURS, les deux champs réservés NULL) — impression indisponible avant relance via generate()', async () => {
    prisma.batch.findFirst.mockResolvedValue({
      ...baseBatch,
      reservedLotNumber: null,
      reservedExpiryDate: null,
    });

    await expect(service.getPrintData(siteId, batchId)).rejects.toThrow(
      BadRequestException,
    );
    expect(batchPreparationService.computeIngredientQuantities).not.toHaveBeenCalled();
  });

  describe('batch EN_COURS avec réservation valide, une allocation', () => {
    beforeEach(() => {
      prisma.batch.findFirst.mockResolvedValue({
        ...baseBatch,
        allocations: [allocationA],
      });
      batchPreparationService.computeIngredientQuantities.mockResolvedValue([
        pgLine,
        vgLine,
        packagingLine,
      ]);
    });

    it('retourne des données complètes : lotNumber/expiryDate du Batch, une paire d’étiquettes', async () => {
      const result = await service.getPrintData(siteId, batchId);

      expect(result.batchId).toBe(batchId);
      expect(result.lotNumber).toBe('456149');
      expect(result.expiryDate).toBe(reservedExpiryDate);
      expect(result.allocations).toHaveLength(1);
      expect(result.allocations[0]).toEqual({
        allocationId: 'alloc-A',
        productName: 'Produit A',
        quantityToBatch: 300,
        ingredients: [pgLine, vgLine, packagingLine],
      });
    });

    it('appelle computeIngredientQuantities avec la recette et la quantité PLANIFIÉE de l’allocation (jamais recalculées)', async () => {
      await service.getPrintData(siteId, batchId);

      expect(
        batchPreparationService.computeIngredientQuantities,
      ).toHaveBeenCalledWith(siteId, 'recipe-A', 300);
      expect(
        batchPreparationService.computeIngredientQuantities,
      ).toHaveBeenCalledTimes(1);
    });

    it('PG est présent tel quel dans les ingrédients, sans traitement spécial', async () => {
      const result = await service.getPrintData(siteId, batchId);

      expect(result.allocations[0].ingredients).toContainEqual(pgLine);
    });

    it('VG est présent tel quel dans les ingrédients, sans traitement spécial', async () => {
      const result = await service.getPrintData(siteId, batchId);

      expect(result.allocations[0].ingredients).toContainEqual(vgLine);
    });

    it('appelable un nombre quelconque de fois sans effet de bord (aucune méthode de mutation n’existe sur les mocks fournis)', async () => {
      const first = await service.getPrintData(siteId, batchId);
      const second = await service.getPrintData(siteId, batchId);

      expect(second).toEqual(first);
      // Le mock `prisma` ci-dessus n'expose que `batch.findFirst` : tout appel à une
      // méthode de mutation (create/update/delete, sur Batch, Lot ou LotNumberCounter)
      // aurait fait échouer ce test avec une TypeError avant même cette assertion.
    });
  });

  describe('batch EN_COURS avec réservation valide, deux allocations', () => {
    beforeEach(() => {
      prisma.batch.findFirst.mockResolvedValue({
        ...baseBatch,
        allocations: [allocationA, allocationB],
      });
      batchPreparationService.computeIngredientQuantities.mockImplementation(
        (_siteId: string, recipeId: string) =>
          Promise.resolve(
            recipeId === 'recipe-A' ? [pgLine, packagingLine] : [vgLine],
          ),
      );
    });

    it('retourne deux paires d’étiquettes, jamais fusionnées', async () => {
      const result = await service.getPrintData(siteId, batchId);

      expect(result.allocations).toHaveLength(2);
    });

    it('lotNumber et expiryDate sont identiques pour toutes les allocations (un seul champ racine, partagé implicitement)', async () => {
      const result = await service.getPrintData(siteId, batchId);

      // Un seul champ `lotNumber`/`expiryDate` au niveau racine de la réponse :
      // structurellement partagé par toutes les allocations, jamais dupliqué ni
      // recalculé par allocation.
      expect(result.lotNumber).toBe('456149');
      expect(result.expiryDate).toBe(reservedExpiryDate);
    });

    it('productName et quantityToBatch sont propres à chaque allocation', async () => {
      const result = await service.getPrintData(siteId, batchId);

      expect(result.allocations[0]).toMatchObject({
        allocationId: 'alloc-A',
        productName: 'Produit A',
        quantityToBatch: 300,
      });
      expect(result.allocations[1]).toMatchObject({
        allocationId: 'alloc-B',
        productName: 'Produit B',
        quantityToBatch: 150,
      });
    });

    it('les ingrédients sont propres à chaque allocation (recette distincte, jamais fusionnés)', async () => {
      const result = await service.getPrintData(siteId, batchId);

      expect(result.allocations[0].ingredients).toEqual([pgLine, packagingLine]);
      expect(result.allocations[1].ingredients).toEqual([vgLine]);
      expect(
        batchPreparationService.computeIngredientQuantities,
      ).toHaveBeenCalledWith(siteId, 'recipe-A', 300);
      expect(
        batchPreparationService.computeIngredientQuantities,
      ).toHaveBeenCalledWith(siteId, 'recipe-B', 150);
      expect(
        batchPreparationService.computeIngredientQuantities,
      ).toHaveBeenCalledTimes(2);
    });
  });

  describe('batch EN_COURS sans allocation (repli historique, antérieur à PRD-11)', () => {
    beforeEach(() => {
      prisma.batch.findFirst.mockResolvedValue({ ...baseBatch, allocations: [] });
      batchPreparationService.computeIngredientQuantities.mockResolvedValue([
        pgLine,
      ]);
    });

    it('produit une paire d’étiquettes unique, allocationId null, produit dérivé de la recette du batch', async () => {
      const result = await service.getPrintData(siteId, batchId);

      expect(result.allocations).toHaveLength(1);
      expect(result.allocations[0]).toEqual({
        allocationId: null,
        productName: 'Produit de référence',
        quantityToBatch: 500,
        ingredients: [pgLine],
      });
      expect(
        batchPreparationService.computeIngredientQuantities,
      ).toHaveBeenCalledWith(siteId, 'recipe-1', 500);
    });
  });
});
