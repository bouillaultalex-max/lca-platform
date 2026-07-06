import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  BatchPreparationService,
  type MaterialQuantity,
  type PackagingQuantity,
} from './batch-preparation.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ArticleType, Prisma } from '../../../generated/prisma/client';

describe('BatchPreparationService', () => {
  let service: BatchPreparationService;
  let prisma: { recipe: { findFirst: jest.Mock } };

  const siteId = 'site-1';
  const recipeId = 'recipe-1';

  const matierePremiere = (
    id: string,
    percentage: number,
    density: number | null,
  ) => ({
    quantityPerUnit: new Prisma.Decimal(percentage),
    unit: '%',
    article: {
      id,
      name: `MP-${id}`,
      type: ArticleType.MATIERE_PREMIERE,
      unitOfMeasure: 'L',
      densityKgPerL: density === null ? null : new Prisma.Decimal(density),
    },
  });

  const packaging = (id: string, quantityPerUnit: number) => ({
    quantityPerUnit: new Prisma.Decimal(quantityPerUnit),
    unit: 'unité',
    article: {
      id,
      name: `PKG-${id}`,
      type: ArticleType.PACKAGING,
      unitOfMeasure: 'unité',
      densityKgPerL: null,
    },
  });

  beforeEach(async () => {
    prisma = { recipe: { findFirst: jest.fn() } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BatchPreparationService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(BatchPreparationService);
  });

  it('lève NotFoundException si la recette est introuvable sur ce site', async () => {
    prisma.recipe.findFirst.mockResolvedValue(null);

    await expect(
      service.computeIngredientQuantities(siteId, recipeId, 100),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejette une quantité à produire nulle ou négative sans interroger la base', async () => {
    await expect(
      service.computeIngredientQuantities(siteId, recipeId, 0),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.computeIngredientQuantities(siteId, recipeId, -10),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.recipe.findFirst).not.toHaveBeenCalled();
  });

  it('calcule le volume et la masse pour une matière première unique à 100%, avec densité', async () => {
    prisma.recipe.findFirst.mockResolvedValue({
      format: 100, // ml
      lines: [matierePremiere('mp-1', 100, 0.9), packaging('pkg-1', 1)],
    });

    const result = await service.computeIngredientQuantities(
      siteId,
      recipeId,
      500,
    );

    // volumeTotalL = 100 ml * 500 unités / 1000 = 50 L
    const mp = result.find(
      (r) => r.kind === 'MATIERE_PREMIERE',
    ) as MaterialQuantity;
    expect(mp.volumeL).toBeCloseTo(50);
    expect(mp.massKg).toBeCloseTo(45); // 50 L * 0.9 kg/L

    const pkg = result.find((r) => r.kind === 'PACKAGING') as PackagingQuantity;
    expect(pkg.quantity).toBe(500); // 1 * 500
    expect(pkg.unit).toBe('unité');
  });

  it('retourne massKg = null quand la densité n’est pas renseignée', async () => {
    prisma.recipe.findFirst.mockResolvedValue({
      format: 100,
      lines: [matierePremiere('mp-1', 100, null)],
    });

    const result = await service.computeIngredientQuantities(
      siteId,
      recipeId,
      500,
    );

    const mp = result[0] as MaterialQuantity;
    expect(mp.volumeL).toBeCloseTo(50);
    expect(mp.massKg).toBeNull();
  });

  it('répartit correctement le volume entre plusieurs matières premières selon leur pourcentage', async () => {
    prisma.recipe.findFirst.mockResolvedValue({
      format: 100,
      lines: [matierePremiere('mp-1', 60, 1), matierePremiere('mp-2', 40, 1)],
    });

    const result = await service.computeIngredientQuantities(
      siteId,
      recipeId,
      1000,
    );

    // volumeTotalL = 100 * 1000 / 1000 = 100 L
    const mp1 = result.find((r) => r.articleId === 'mp-1') as MaterialQuantity;
    const mp2 = result.find((r) => r.articleId === 'mp-2') as MaterialQuantity;
    expect(mp1.volumeL).toBeCloseTo(60);
    expect(mp2.volumeL).toBeCloseTo(40);
    expect(mp1.volumeL + mp2.volumeL).toBeCloseTo(100);
  });

  it('gère des pourcentages avec arrondis (33.33/33.33/33.34) sans erreur et somme au total', async () => {
    prisma.recipe.findFirst.mockResolvedValue({
      format: 200,
      lines: [
        matierePremiere('mp-1', 33.33, 1),
        matierePremiere('mp-2', 33.33, 1),
        matierePremiere('mp-3', 33.34, 1),
      ],
    });

    const result = await service.computeIngredientQuantities(
      siteId,
      recipeId,
      100,
    );

    // volumeTotalL = 200 * 100 / 1000 = 20 L
    const total = result.reduce(
      (sum, r) => sum + (r as MaterialQuantity).volumeL,
      0,
    );
    expect(total).toBeCloseTo(20);
  });

  it('calcule plusieurs lignes de packaging indépendamment (flacon, bouchon, étiquette)', async () => {
    prisma.recipe.findFirst.mockResolvedValue({
      format: 100,
      lines: [
        packaging('flacon', 1),
        packaging('bouchon', 1),
        packaging('etiquette', 2),
      ],
    });

    const result = await service.computeIngredientQuantities(
      siteId,
      recipeId,
      300,
    );

    expect(
      (result.find((r) => r.articleId === 'flacon') as PackagingQuantity)
        .quantity,
    ).toBe(300);
    expect(
      (result.find((r) => r.articleId === 'bouchon') as PackagingQuantity)
        .quantity,
    ).toBe(300);
    expect(
      (result.find((r) => r.articleId === 'etiquette') as PackagingQuantity)
        .quantity,
    ).toBe(600);
  });
});
