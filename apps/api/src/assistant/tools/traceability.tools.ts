import type { TraceabilityService } from '../../traceability/traceability.service';
import { GetLotByNumberInputDto } from './dto/get-lot-by-number-input.dto';
import type { ToolDefinition } from './tool.types';

export interface LotGenealogyLineToolResult {
  consumedArticleName: string;
  consumedArticleReference: string;
  supplierLotNumber: string;
  consumedQuantity: number;
}

export interface LotByNumberToolResult {
  lotNumber: string;
  quantity: number;
  manufacturedAt: Date;
  expiryDate: Date | null;
  qualityStatus: string;
  finishedProductName: string;
  recipeFormat: number;
  recipeVersion: number;
  genealogy: LotGenealogyLineToolResult[];
}

export function createTraceabilityTools(
  traceabilityService: TraceabilityService,
): ToolDefinition[] {
  const getLotByNumber: ToolDefinition<
    GetLotByNumberInputDto,
    LotByNumberToolResult
  > = {
    name: 'traceability.getLotByNumber',
    description:
      "Renvoie la généalogie complète d'un lot fini identifié par son numéro métier (produit fini, recette, statut qualité, et chaque article/lot fournisseur consommé). Ne jamais inventer un numéro de lot : l'utiliser tel que fourni par l'utilisateur.",
    inputSchema: GetLotByNumberInputDto,
    permission: { kind: 'authenticated' },
    category: 'read',
    handler: async (user, input) => {
      const lot = await traceabilityService.findLotTraceabilityByNumber(
        user.siteId,
        input.lotNumber,
      );

      return {
        lotNumber: lot.lotNumber,
        quantity: lot.quantity,
        manufacturedAt: lot.manufacturedAt,
        expiryDate: lot.expiryDate,
        qualityStatus: lot.qualityStatus,
        finishedProductName: lot.batch.recipe.finishedProduct.name,
        recipeFormat: lot.batch.recipe.format,
        recipeVersion: lot.batch.recipe.version,
        genealogy: lot.genealogyLines.map((line) => ({
          consumedArticleName: line.consumedArticle.name,
          consumedArticleReference: line.consumedArticle.openSiReference,
          supplierLotNumber: line.consumedStockLot.supplierLotNumber,
          consumedQuantity: line.consumedQuantity.toNumber(),
        })),
      };
    },
  };

  return [getLotByNumber];
}
