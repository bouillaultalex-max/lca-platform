import type { Article, BatchClosureResult, BatchProductAllocation, Lot, Market } from '@lca-mes/shared';

/**
 * Résout les lots générés par une clôture (voir BatchClosureResult, ADR 0006 PRD-11) :
 * `lots` est la réponse officielle du backend, un lot par allocation (ou un lot
 * unique pour un batch historique sans allocation). `lot` n'est qu'un alias
 * temporaire de compatibilité backend (vers `lots[0]`) — utilisé ici uniquement en
 * ultime secours défensif si `lots` était absent ou vide, ce qui ne devrait jamais
 * arriver avec le backend actuel. À supprimer lorsque le backend retirera `lot`.
 */
export function resolveClosureLots(result: BatchClosureResult): Lot[] {
  if (Array.isArray(result.lots) && result.lots.length > 0) {
    return result.lots;
  }
  return result.lot ? [result.lot] : [];
}

/** Un lot de clôture enrichi des seules informations réellement fournies par le backend. */
export interface EnrichedClosureLot {
  lotNumber: string;
  quantity: number;
  /** `null` pour un lot historique (aucune allocation) ou une allocation introuvable. */
  productName: string | null;
  /** `null` si l'allocation n'a pas de marché, ou pour un lot historique. */
  marketLabel: string | null;
}

/**
 * Enrichit chaque lot de son produit/marché en résolvant `lot.allocationId` parmi
 * les allocations déjà chargées dans ProductionPage — aucune requête réseau
 * supplémentaire. Un lot historique (`allocationId: null`) n'a par construction
 * aucun produit/marché à résoudre : ce n'est pas une donnée manquante par erreur.
 */
export function enrichClosureLots(
  lots: Lot[],
  allocations: BatchProductAllocation[],
  articlesById: Map<string, Article>,
  marketsById: Map<string, Market>,
): EnrichedClosureLot[] {
  const allocationsById = new Map(allocations.map((allocation) => [allocation.id, allocation]));

  return lots.map((lot) => {
    const allocation = lot.allocationId ? allocationsById.get(lot.allocationId) : undefined;
    const productName = allocation ? (articlesById.get(allocation.productId)?.name ?? null) : null;
    const marketLabel =
      allocation?.marketId != null ? (marketsById.get(allocation.marketId)?.label ?? null) : null;

    return {
      lotNumber: lot.lotNumber,
      quantity: lot.quantity,
      productName,
      marketLabel,
    };
  });
}
