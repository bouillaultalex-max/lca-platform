import { computeBatchCost } from './batch-cost-calculation';
import { Prisma } from '../../../generated/prisma/client';

describe('computeBatchCost (fonction pure)', () => {
  const line = (quantity: number | string, unitCost: number | string) => ({
    quantity: new Prisma.Decimal(quantity),
    unitCost: new Prisma.Decimal(unitCost),
  });

  it('calcule le coût avec matière première seule (packaging vide)', () => {
    const result = computeBatchCost({
      materialConsumptions: [line(50, 2)],
      packagingConsumptions: [],
      producedQuantityTotal: new Prisma.Decimal(500),
    });

    expect(result.materialCostTotal.toString()).toBe('100');
    expect(result.packagingCostTotal.toString()).toBe('0');
    expect(result.totalCost.toString()).toBe('100');
    expect(result.unitCostPerFlacon.toString()).toBe('0.2');
  });

  it('calcule le coût avec packaging seul (matière première vide)', () => {
    const result = computeBatchCost({
      materialConsumptions: [],
      packagingConsumptions: [line(500, 0.1)],
      producedQuantityTotal: new Prisma.Decimal(500),
    });

    expect(result.materialCostTotal.toString()).toBe('0');
    expect(result.packagingCostTotal.toString()).toBe('50');
    expect(result.totalCost.toString()).toBe('50');
    expect(result.unitCostPerFlacon.toString()).toBe('0.1');
  });

  it('additionne matière première et packaging pour le coût total', () => {
    const result = computeBatchCost({
      materialConsumptions: [line(50, 2)], // 100
      packagingConsumptions: [line(500, 0.1)], // 50
      producedQuantityTotal: new Prisma.Decimal(500),
    });

    expect(result.materialCostTotal.toString()).toBe('100');
    expect(result.packagingCostTotal.toString()).toBe('50');
    expect(result.totalCost.toString()).toBe('150');
    expect(result.unitCostPerFlacon.toString()).toBe('0.3');
  });

  it('additionne plusieurs consommations du même article (ex. plusieurs lignes de recette)', () => {
    const result = computeBatchCost({
      materialConsumptions: [line(20, 2), line(30, 2)], // même article, deux lignes : 40 + 60
      packagingConsumptions: [],
      producedQuantityTotal: new Prisma.Decimal(500),
    });

    expect(result.materialCostTotal.toString()).toBe('100');
  });

  it('additionne plusieurs consommations issues de StockLot FIFO différents pour un même article (même coût unitaire)', () => {
    // Un même article consommé sur deux StockLot distincts (répartition FIFO) : le
    // prix est celui de l'article (Article.currentUnitCost), identique pour les deux
    // lignes — seule la quantité diffère selon le StockLot d'origine.
    const result = computeBatchCost({
      materialConsumptions: [line(12, 2), line(8, 2)], // StockLot A: 12, StockLot B: 8, même article
      packagingConsumptions: [],
      producedQuantityTotal: new Prisma.Decimal(500),
    });

    expect(result.materialCostTotal.toString()).toBe('40');
  });

  it('utilise une arithmétique décimale sûre (pas de perte de précision en virgule flottante)', () => {
    const result = computeBatchCost({
      materialConsumptions: [line('0.1', '0.2')],
      packagingConsumptions: [],
      producedQuantityTotal: new Prisma.Decimal(3),
    });

    // 0.1 * 0.2 = 0.02 exact en Decimal (0.1 + 0.2 !== 0.3 en flottant JS classique,
    // mais ce n'est pas le calcul ici : on vérifie l'absence de dérive similaire).
    expect(result.materialCostTotal.toString()).toBe('0.02');
    expect(result.materialCostTotal).toBeInstanceOf(Prisma.Decimal);
    expect(result.unitCostPerFlacon).toBeInstanceOf(Prisma.Decimal);
  });

  it('gère une quantité produite différente de la quantité traitée (rebuts inclus dans le dénominateur)', () => {
    // Lot : 480 conformes + 20 rebuts = 500 traité. Le dénominateur attendu est bien
    // 500 (quantité traitée), pas 480 (conforme seule) — voir ADR 0007/docs/regles-metier.md §5.
    const result = computeBatchCost({
      materialConsumptions: [line(50, 2)], // 100
      packagingConsumptions: [line(500, 0.1)], // 50
      producedQuantityTotal: new Prisma.Decimal(500), // 480 produits + 20 rebuts
    });

    expect(result.totalCost.toString()).toBe('150');
    expect(result.unitCostPerFlacon.toString()).toBe('0.3'); // 150 / 500, pas 150 / 480
  });

  it('lève une erreur si la quantité totale traitée est nulle ou négative (garde défensive)', () => {
    expect(() =>
      computeBatchCost({
        materialConsumptions: [line(50, 2)],
        packagingConsumptions: [],
        producedQuantityTotal: new Prisma.Decimal(0),
      }),
    ).toThrow();

    expect(() =>
      computeBatchCost({
        materialConsumptions: [line(50, 2)],
        packagingConsumptions: [],
        producedQuantityTotal: new Prisma.Decimal(-1),
      }),
    ).toThrow();
  });
});
