import type { DashboardService } from '../../dashboard/dashboard.service';
import type { ToolDefinition } from './tool.types';

/**
 * Projection dédiée de l'outil (jamais le type `DashboardSummary` du service,
 * même si la forme est identique aujourd'hui — voir AI-03 : « chaque outil
 * construit explicitement sa propre réponse »). Ouvert à tout utilisateur
 * authentifié, comme `GET /dashboard/summary` (aucune restriction de rôle sur
 * ce endpoint, voir dashboard.controller.ts).
 */
export interface DashboardSummaryToolResult {
  articlesCount: number;
  activeRecipesCount: number;
  activeMachinesCount: number;
  stockLotsCount: number;
  openBatchesCount: number;
  unresolvedFeedbackCount: number;
  pendingExpectedRequirementsCount: number;
}

export function createDashboardTools(
  dashboardService: DashboardService,
): ToolDefinition[] {
  const getSummary: ToolDefinition<object, DashboardSummaryToolResult> = {
    name: 'dashboard.getSummary',
    description:
      "Renvoie les compteurs de synthèse du tableau de bord (articles actifs, recettes actives, machines actives, lots de stock disponibles, lots de fabrication ouverts, retours non résolus, besoins prévisionnels en attente) pour le site de l'utilisateur.",
    inputSchema: undefined,
    permission: { kind: 'authenticated' },
    category: 'read',
    handler: async (user) => {
      const summary = await dashboardService.getSummary(user.siteId);
      return {
        articlesCount: summary.articlesCount,
        activeRecipesCount: summary.activeRecipesCount,
        activeMachinesCount: summary.activeMachinesCount,
        stockLotsCount: summary.stockLotsCount,
        openBatchesCount: summary.openBatchesCount,
        unresolvedFeedbackCount: summary.unresolvedFeedbackCount,
        pendingExpectedRequirementsCount:
          summary.pendingExpectedRequirementsCount,
      };
    },
  };

  return [getSummary];
}
