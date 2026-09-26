import { createTraceabilityTools } from './traceability.tools';
import type { TraceabilityService } from '../../traceability/traceability.service';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user';
import { UserRole } from '../../../generated/prisma/client';

function decimal(value: number) {
  return { toNumber: () => value };
}

function buildUser(
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser {
  return {
    id: 'user-1',
    siteId: 'site-1',
    fullName: 'Kevin Prian',
    email: 'kevin.prian@lca-mes.local',
    role: UserRole.DIRECTION,
    jobTitle: null,
    isSystemAdmin: false,
    mustChangePassword: false,
    lastLoginAt: null,
    ...overrides,
  };
}

function buildLotFixture(overrides: Record<string, unknown> = {}) {
  return {
    lotNumber: '455123',
    quantity: 1000,
    manufacturedAt: new Date('2026-05-01T00:00:00.000Z'),
    expiryDate: null,
    qualityStatus: 'CONFORME',
    batch: {
      recipe: {
        format: 100,
        version: 3,
        finishedProduct: { name: 'Fuel Air Frais 100ml' },
      },
    },
    // Lot historique (sans allocation) par défaut : `batch.recipe` reste la source.
    allocation: null,
    genealogyLines: [
      {
        consumedArticle: {
          name: 'Parfum concentré X',
          openSiReference: 'PAR-X',
        },
        consumedStockLot: { supplierLotNumber: 'SUP-2026-01' },
        consumedQuantity: decimal(12.5),
      },
    ],
    ...overrides,
  };
}

describe('traceability.getLotByNumber (ADR 0010 § Décision 15 : liste, plus objet unique)', () => {
  it('applique la même permission que GET /traceability/lots (authenticated) et projette la généalogie complète pour un résultat unique', async () => {
    const lot = buildLotFixture();
    const findLotTraceabilityByNumber = jest.fn().mockResolvedValue([lot]);
    const traceabilityService = {
      findLotTraceabilityByNumber,
    } as unknown as TraceabilityService;

    const [getLotByNumber] = createTraceabilityTools(traceabilityService);
    expect(getLotByNumber.name).toBe('traceability.getLotByNumber');
    expect(getLotByNumber.permission).toEqual({ kind: 'authenticated' });

    const result = await getLotByNumber.handler(buildUser(), {
      lotNumber: '455123',
    });

    expect(findLotTraceabilityByNumber).toHaveBeenCalledWith(
      'site-1',
      '455123',
    );
    expect(result).toEqual([
      {
        lotNumber: '455123',
        quantity: 1000,
        manufacturedAt: lot.manufacturedAt,
        expiryDate: null,
        qualityStatus: 'CONFORME',
        finishedProductName: 'Fuel Air Frais 100ml',
        marketLabel: null,
        recipeFormat: 100,
        recipeVersion: 3,
        genealogy: [
          {
            consumedArticleName: 'Parfum concentré X',
            consumedArticleReference: 'PAR-X',
            supplierLotNumber: 'SUP-2026-01',
            consumedQuantity: 12.5,
          },
        ],
      },
    ]);
  });

  it("retourne un tableau vide si aucun lot ne correspond, jamais une exception inventée", async () => {
    const traceabilityService = {
      findLotTraceabilityByNumber: jest.fn().mockResolvedValue([]),
    } as unknown as TraceabilityService;
    const [getLotByNumber] = createTraceabilityTools(traceabilityService);

    const result = await getLotByNumber.handler(buildUser(), {
      lotNumber: '000000',
    });

    expect(result).toEqual([]);
  });

  it('numéro partagé par deux lots (deux allocations d’un même batch) : les deux sont représentés, jamais un seul ni fusionnés', async () => {
    // Deux allocations d'un MÊME batch : batch.recipe (recette de référence) est
    // identique pour les deux lots, seule l'allocation porte le produit distinct.
    const lotA = buildLotFixture({
      quantity: 300,
      allocation: {
        product: { name: 'Fuel Air Frais 100ml' },
        market: null,
        recipe: { format: 100, version: 3 },
      },
    });
    const lotB = buildLotFixture({
      quantity: 150,
      allocation: {
        product: { name: 'Fuel Air Frais 100ml — déclinaison Suisse' },
        market: null,
        recipe: { format: 100, version: 3 },
      },
    });
    const traceabilityService = {
      findLotTraceabilityByNumber: jest.fn().mockResolvedValue([lotA, lotB]),
    } as unknown as TraceabilityService;
    const [getLotByNumber] = createTraceabilityTools(traceabilityService);

    const result = await getLotByNumber.handler(buildUser(), {
      lotNumber: '455123',
    });

    expect(result).toHaveLength(2);
    expect(result).toEqual([
      expect.objectContaining({
        quantity: 300,
        finishedProductName: 'Fuel Air Frais 100ml',
      }),
      expect.objectContaining({
        quantity: 150,
        finishedProductName: 'Fuel Air Frais 100ml — déclinaison Suisse',
      }),
    ]);
  });

  it('batch multi-marchés : produit, marché et recette proviennent de l’allocation de chaque lot, jamais de batch.recipe (bug D2)', async () => {
    // Recette de référence du batch = déclinaison France, commune aux deux lots.
    const referenceBatch = {
      recipe: {
        format: 100,
        version: 3,
        finishedProduct: { name: 'Recharge Lavande FR' },
      },
    };
    const lotFr = buildLotFixture({
      quantity: 100,
      batch: referenceBatch,
      allocation: {
        product: { name: 'Recharge Lavande FR' },
        market: { label: 'France' },
        recipe: { format: 100, version: 3 },
      },
    });
    const lotCh = buildLotFixture({
      quantity: 50,
      batch: referenceBatch,
      allocation: {
        product: { name: 'Recharge Lavande CH' },
        market: { label: 'Suisse' },
        recipe: { format: 100, version: 7 },
      },
    });
    const traceabilityService = {
      findLotTraceabilityByNumber: jest.fn().mockResolvedValue([lotFr, lotCh]),
    } as unknown as TraceabilityService;
    const [getLotByNumber] = createTraceabilityTools(traceabilityService);

    const result = await getLotByNumber.handler(buildUser(), {
      lotNumber: '455123',
    });

    expect(result).toEqual([
      expect.objectContaining({
        quantity: 100,
        finishedProductName: 'Recharge Lavande FR',
        marketLabel: 'France',
        recipeVersion: 3,
      }),
      expect.objectContaining({
        quantity: 50,
        finishedProductName: 'Recharge Lavande CH',
        marketLabel: 'Suisse',
        recipeFormat: 100,
        recipeVersion: 7,
      }),
    ]);
  });

  it('allocation sans marché (batch mono-produit) : produit et recette de l’allocation, marketLabel null', async () => {
    const lot = buildLotFixture({
      allocation: {
        product: { name: 'Fuel Air Frais 100ml' },
        market: null,
        recipe: { format: 100, version: 3 },
      },
    });
    const traceabilityService = {
      findLotTraceabilityByNumber: jest.fn().mockResolvedValue([lot]),
    } as unknown as TraceabilityService;
    const [getLotByNumber] = createTraceabilityTools(traceabilityService);

    const result = await getLotByNumber.handler(buildUser(), {
      lotNumber: '455123',
    });

    expect(result).toEqual([
      expect.objectContaining({
        finishedProductName: 'Fuel Air Frais 100ml',
        marketLabel: null,
        recipeFormat: 100,
        recipeVersion: 3,
      }),
    ]);
  });

  it("propage l'erreur si le service échoue réellement (ex. site inconnu), sans l'inventer", async () => {
    const traceabilityService = {
      findLotTraceabilityByNumber: jest
        .fn()
        .mockRejectedValue(new Error('panne base de données')),
    } as unknown as TraceabilityService;
    const [getLotByNumber] = createTraceabilityTools(traceabilityService);

    await expect(
      getLotByNumber.handler(buildUser(), { lotNumber: '000000' }),
    ).rejects.toThrow('panne base de données');
  });
});
