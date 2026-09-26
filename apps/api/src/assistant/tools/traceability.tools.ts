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
  /** Libellé du marché de l'allocation d'origine ; `null` sans marché ou pour un lot historique. */
  marketLabel: string | null;
  recipeFormat: number;
  recipeVersion: number;
  genealogy: LotGenealogyLineToolResult[];
}

export function createTraceabilityTools(
  traceabilityService: TraceabilityService,
): ToolDefinition[] {
  const getLotByNumber: ToolDefinition<
    GetLotByNumberInputDto,
    LotByNumberToolResult[]
  > = {
    name: 'traceability.getLotByNumber',
    description:
      "Renvoie la généalogie complète de tous les lots finis identifiés par un numéro métier (produit fini, marché, recette, statut qualité, et chaque article/lot fournisseur consommé) — toujours une liste, y compris vide si aucun lot ne correspond (ADR 0010 § Décision 15 : plusieurs allocations d'un même batch peuvent désormais partager le même numéro). Pour chaque lot, le produit (finishedProductName), le marché (marketLabel) et la recette (recipeFormat/recipeVersion) sont ceux de son allocation d'origine — deux lots partageant le même numéro peuvent donc avoir des produits et marchés différents ; marketLabel vaut null pour un lot sans marché ou un lot historique antérieur aux allocations (produit et recette du batch dans ce cas). Ne jamais inventer un numéro de lot : l'utiliser tel que fourni par l'utilisateur.",
    inputSchema: GetLotByNumberInputDto,
    permission: { kind: 'authenticated' },
    category: 'read',
    handler: async (user, input) => {
      const lots = await traceabilityService.findLotTraceabilityByNumber(
        user.siteId,
        input.lotNumber,
      );

      return lots.map((lot) => {
        // Produit, marché et recette réellement attribués au lot (ADR 0006,
        // PRD-11) : ceux de son allocation d'origine quand elle existe, sinon
        // `batch.recipe` pour un lot historique (comportement antérieur).
        const product =
          lot.allocation?.product ?? lot.batch.recipe.finishedProduct;
        const recipe = lot.allocation?.recipe ?? lot.batch.recipe;
        return {
          lotNumber: lot.lotNumber,
          quantity: lot.quantity,
          manufacturedAt: lot.manufacturedAt,
          expiryDate: lot.expiryDate,
          qualityStatus: lot.qualityStatus,
          finishedProductName: product.name,
          marketLabel: lot.allocation?.market?.label ?? null,
          recipeFormat: recipe.format,
          recipeVersion: recipe.version,
          genealogy: lot.genealogyLines.map((line) => ({
            consumedArticleName: line.consumedArticle.name,
            consumedArticleReference: line.consumedArticle.openSiReference,
            supplierLotNumber: line.consumedStockLot.supplierLotNumber,
            consumedQuantity: line.consumedQuantity.toNumber(),
          })),
        };
      });
    },
  };

  return [getLotByNumber];
}
