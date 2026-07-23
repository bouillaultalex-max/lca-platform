import type { StockItemsService } from '../../stock/stock-items/stock-items.service';
import { searchArticlesByQuery } from './article-search.util';
import { GetArticleAvailabilityInputDto } from './dto/get-article-availability-input.dto';
import type { ToolDefinition } from './tool.types';

const ARTICLE_SEARCH_RESULTS_LIMIT = 10;
const LOW_STOCK_RESULTS_LIMIT = 20;

export interface ArticleAvailabilityToolResult {
  articleId: string;
  articleName: string;
  openSiReference: string;
  availableQuantity: number;
  minimumThreshold: number | null;
  isLowStock: boolean | null;
}

export interface LowStockItemToolResult {
  articleId: string;
  articleName: string;
  openSiReference: string;
  availableQuantity: number;
  minimumThreshold: number;
}

export function createStockTools(
  stockItemsService: StockItemsService,
): ToolDefinition[] {
  const getArticleAvailability: ToolDefinition<
    GetArticleAvailabilityInputDto,
    ArticleAvailabilityToolResult[]
  > = {
    name: 'stock.getArticleAvailability',
    description:
      "Recherche des articles par nom ou référence OpenSi et renvoie leur quantité disponible en stock (jusqu'à 10 résultats).",
    inputSchema: GetArticleAvailabilityInputDto,
    permission: { kind: 'authenticated' },
    category: 'read',
    handler: async (user, input) => {
      const items = await stockItemsService.findAll(user.siteId);
      const matches = searchArticlesByQuery(
        items,
        input.query,
        ARTICLE_SEARCH_RESULTS_LIMIT,
      );

      return matches.map((item) => ({
        articleId: item.articleId,
        articleName: item.article.name,
        openSiReference: item.article.openSiReference,
        availableQuantity: item.availableQuantity.toNumber(),
        minimumThreshold: item.minimumThreshold?.toNumber() ?? null,
        isLowStock: item.isLowStock,
      }));
    },
  };

  const listLowStockItems: ToolDefinition<object, LowStockItemToolResult[]> = {
    name: 'stock.listLowStockItems',
    description:
      "Liste les articles dont le stock disponible est actuellement en dessous ou égal à leur seuil minimum (jusqu'à 20 résultats).",
    inputSchema: undefined,
    permission: { kind: 'authenticated' },
    category: 'read',
    handler: async (user) => {
      const items = await stockItemsService.findAll(user.siteId);

      return items
        .filter((item) => item.isLowStock === true)
        .slice(0, LOW_STOCK_RESULTS_LIMIT)
        .map((item) => ({
          articleId: item.articleId,
          articleName: item.article.name,
          openSiReference: item.article.openSiReference,
          availableQuantity: item.availableQuantity.toNumber(),
          // Non-null : filtré ci-dessus sur `isLowStock === true`, qui ne peut
          // être vrai que lorsqu'un seuil est défini (voir stock-items.service.ts).
          minimumThreshold: item.minimumThreshold!.toNumber(),
        }));
    },
  };

  return [getArticleAvailability, listLowStockItems];
}
