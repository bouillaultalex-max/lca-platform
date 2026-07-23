import { createStockTools } from './stock.tools';
import type { StockItemsService } from '../../stock/stock-items/stock-items.service';
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

function buildStockItems() {
  return [
    {
      articleId: 'art-1',
      article: { name: 'Flacon 100ml ambré', openSiReference: 'FLA-100' },
      availableQuantity: decimal(500),
      minimumThreshold: decimal(100),
      isLowStock: false,
    },
    {
      articleId: 'art-2',
      article: { name: 'Bouchon compte-gouttes', openSiReference: 'BOU-CG' },
      availableQuantity: decimal(10),
      minimumThreshold: decimal(50),
      isLowStock: true,
    },
    {
      articleId: 'art-3',
      article: { name: 'Étiquette premium', openSiReference: 'ETI-01' },
      availableQuantity: decimal(200),
      minimumThreshold: null,
      isLowStock: null,
    },
  ];
}

describe('stock.tools', () => {
  describe('stock.getArticleAvailability', () => {
    it('applique la même permission que GET /stock/items (authenticated) et projette les champs attendus', async () => {
      const findAll = jest.fn().mockResolvedValue(buildStockItems());
      const stockItemsService = { findAll } as unknown as StockItemsService;
      const [getArticleAvailability] = createStockTools(stockItemsService);

      expect(getArticleAvailability.name).toBe('stock.getArticleAvailability');
      expect(getArticleAvailability.permission).toEqual({
        kind: 'authenticated',
      });

      const result = await getArticleAvailability.handler(buildUser(), {
        query: 'flacon',
      });

      expect(findAll).toHaveBeenCalledWith('site-1');
      expect(result).toEqual([
        {
          articleId: 'art-1',
          articleName: 'Flacon 100ml ambré',
          openSiReference: 'FLA-100',
          availableQuantity: 500,
          minimumThreshold: 100,
          isLowStock: false,
        },
      ]);
    });

    it('renvoie un tableau vide si aucun article ne correspond à la recherche', async () => {
      const stockItemsService = {
        findAll: jest.fn().mockResolvedValue(buildStockItems()),
      } as unknown as StockItemsService;
      const [getArticleAvailability] = createStockTools(stockItemsService);

      const result = await getArticleAvailability.handler(buildUser(), {
        query: 'inexistant',
      });

      expect(result).toEqual([]);
    });
  });

  describe('stock.listLowStockItems', () => {
    it('ne renvoie que les articles en stock faible (isLowStock === true)', async () => {
      const stockItemsService = {
        findAll: jest.fn().mockResolvedValue(buildStockItems()),
      } as unknown as StockItemsService;
      const [, listLowStockItems] = createStockTools(stockItemsService);

      expect(listLowStockItems.name).toBe('stock.listLowStockItems');
      expect(listLowStockItems.permission).toEqual({ kind: 'authenticated' });

      const result = await listLowStockItems.handler(buildUser(), {});

      expect(result).toEqual([
        {
          articleId: 'art-2',
          articleName: 'Bouchon compte-gouttes',
          openSiReference: 'BOU-CG',
          availableQuantity: 10,
          minimumThreshold: 50,
        },
      ]);
    });
  });
});
