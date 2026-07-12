/**
 * Compteurs de synthèse pour la vision globale du tableau de bord — agrégation en
 * lecture seule, aucune donnée ni logique métier nouvelle (voir docs/roadmap.md).
 */
export interface DashboardSummary {
  articlesCount: number;
  activeRecipesCount: number;
  activeMachinesCount: number;
  stockLotsCount: number;
  openBatchesCount: number;
  unresolvedFeedbackCount: number;
  pendingExpectedRequirementsCount: number;
}
