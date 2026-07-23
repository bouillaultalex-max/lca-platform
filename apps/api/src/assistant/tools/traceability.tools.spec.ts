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

describe('traceability.getLotByNumber', () => {
  it('applique la même permission que GET /traceability/lots (authenticated) et projette la généalogie complète', async () => {
    const manufacturedAt = new Date('2026-05-01T00:00:00.000Z');
    const findLotTraceabilityByNumber = jest.fn().mockResolvedValue({
      lotNumber: '455123',
      quantity: 1000,
      manufacturedAt,
      expiryDate: null,
      qualityStatus: 'CONFORME',
      batch: {
        recipe: {
          format: 100,
          version: 3,
          finishedProduct: { name: 'Fuel Air Frais 100ml' },
        },
      },
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
    });
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
    expect(result).toEqual({
      lotNumber: '455123',
      quantity: 1000,
      manufacturedAt,
      expiryDate: null,
      qualityStatus: 'CONFORME',
      finishedProductName: 'Fuel Air Frais 100ml',
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
    });
  });

  it("propage l'erreur si le lot n'existe pas, sans l'inventer", async () => {
    const traceabilityService = {
      findLotTraceabilityByNumber: jest
        .fn()
        .mockRejectedValue(new Error('Lot 000000 introuvable.')),
    } as unknown as TraceabilityService;
    const [getLotByNumber] = createTraceabilityTools(traceabilityService);

    await expect(
      getLotByNumber.handler(buildUser(), { lotNumber: '000000' }),
    ).rejects.toThrow('Lot 000000 introuvable.');
  });
});
