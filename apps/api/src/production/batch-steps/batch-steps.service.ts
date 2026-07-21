import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BatchFeasibilityService } from '../../batching/batch-feasibility/batch-feasibility.service';
import {
  Batch,
  BatchStatus,
  BatchStep,
} from '../../../generated/prisma/client';

/// Ordre imposé du workflow réel (voir docs/regles-metier.md §12). Aucune étape de
/// maturation, aucun retour en arrière possible pour l'instant (voir décision explicite
/// à prévoir plus tard).
const STEP_ORDER: BatchStep[] = [
  BatchStep.PREPARATION,
  BatchStep.MELANGE,
  BatchStep.INCORPORATION_TREMIE,
  BatchStep.CONDITIONNEMENT,
];

@Injectable()
export class BatchStepsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly batchFeasibilityService: BatchFeasibilityService,
  ) {}

  /**
   * Fait progresser le batch à l'étape suivante. Un batch sans étape (`currentStep`
   * `null`, statut `PLANIFIE`) démarre à `PREPARATION` et passe en `EN_COURS`.
   * Aucun saut ni retour en arrière : toujours l'étape suivante dans `STEP_ORDER`.
   *
   * Ce tout premier passage (le "lancement" du batch) est bloqué si les stocks
   * disponibles ne couvrent pas les besoins de la recette pour la quantité planifiée
   * (retour métier de Kevin) — revérifié ici indépendamment de ce que le frontend a pu
   * afficher au préalable (voir GET .../feasibility), pour ne jamais faire confiance à
   * un état potentiellement obsolète. Les étapes suivantes ne consomment aucun stock
   * supplémentaire dans ce modèle (la déduction n'a lieu qu'à la clôture) et ne sont
   * donc pas revérifiées.
   */
  async advance(siteId: string, batchId: string): Promise<Batch> {
    const batch = await this.prisma.batch.findFirst({
      where: { id: batchId, siteId },
    });
    if (!batch) {
      throw new NotFoundException(`Batch ${batchId} introuvable.`);
    }

    if (
      batch.status === BatchStatus.TERMINE ||
      batch.status === BatchStatus.ANNULE
    ) {
      throw new BadRequestException(
        'Impossible de faire progresser un batch terminé ou annulé.',
      );
    }

    if (batch.currentStep === null) {
      const feasibility = await this.batchFeasibilityService.checkFeasibility(
        siteId,
        batchId,
      );
      if (!feasibility.isFeasible) {
        throw new BadRequestException(
          'Ce batch ne peut pas être lancé car les stocks sont insuffisants.',
        );
      }

      return this.prisma.batch.update({
        where: { id: batchId },
        data: {
          currentStep: BatchStep.PREPARATION,
          status: BatchStatus.EN_COURS,
          startedAt: batch.startedAt ?? new Date(),
        },
      });
    }

    const currentIndex = STEP_ORDER.indexOf(batch.currentStep);
    if (currentIndex === STEP_ORDER.length - 1) {
      throw new BadRequestException(
        'Le batch est déjà à la dernière étape (conditionnement) ; la clôture du batch n’est pas encore disponible.',
      );
    }

    return this.prisma.batch.update({
      where: { id: batchId },
      data: { currentStep: STEP_ORDER[currentIndex + 1] },
    });
  }
}
