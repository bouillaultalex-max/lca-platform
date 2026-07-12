import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface DashboardSummary {
  articlesCount: number;
  activeRecipesCount: number;
  activeMachinesCount: number;
  stockLotsCount: number;
  openBatchesCount: number;
  unresolvedFeedbackCount: number;
  pendingExpectedRequirementsCount: number;
}

/**
 * Compteurs de synthèse pour la vision globale du tableau de bord (voir Jalon
 * "V0.3 : améliore le tableau de bord") — agrégation en lecture seule, aucune
 * logique métier nouvelle : chaque compteur reflète un état déjà représenté
 * ailleurs dans l'application (Catalogue, Stock, Production, Retours, Imports).
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(siteId: string): Promise<DashboardSummary> {
    const [
      articlesCount,
      activeRecipesCount,
      activeMachinesCount,
      stockLotsCount,
      openBatchesCount,
      unresolvedFeedbackCount,
      pendingExpectedRequirementsCount,
    ] = await Promise.all([
      this.prisma.article.count({ where: { siteId, active: true } }),
      this.prisma.recipe.count({ where: { siteId, status: 'ACTIVE' } }),
      this.prisma.machine.count({ where: { siteId, active: true } }),
      this.prisma.stockLot.count({
        where: { siteId, remainingQuantity: { gt: 0 } },
      }),
      this.prisma.batch.count({
        where: { siteId, status: { in: ['PLANIFIE', 'EN_COURS'] } },
      }),
      this.prisma.feedback.count({ where: { siteId, status: 'NOUVEAU' } }),
      // Aucun statut sur ExpectedRequirement (historique append-only, voir
      // docs/modele-donnees.md) : tant que le module de planification (Jalon 3)
      // n'existe pas pour les "consommer", chaque ligne importée est de fait
      // toujours "en attente" — le compte total reflète donc exactement cela.
      this.prisma.expectedRequirement.count({ where: { siteId } }),
    ]);

    return {
      articlesCount,
      activeRecipesCount,
      activeMachinesCount,
      stockLotsCount,
      openBatchesCount,
      unresolvedFeedbackCount,
      pendingExpectedRequirementsCount,
    };
  }
}
