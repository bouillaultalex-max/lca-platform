import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BatchFeasibilityService } from '../../batching/batch-feasibility/batch-feasibility.service';
import { LotNumberGeneratorService } from '../lot-number-generator/lot-number-generator.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { computeReservedExpiryDate } from './reserved-expiry-date.util';
import {
  AuditAction,
  Batch,
  BatchStatus,
  BatchStep,
} from '../../../generated/prisma/client';

/** Forme minimale de la ligne `batches` lue sous verrou (`SELECT ... FOR UPDATE`) —
 * uniquement les colonnes nécessaires à la revalidation et au calcul du lancement
 * (voir ADR 0010 § Décision 10). Le typage TypeScript n'est qu'une annotation ; la
 * lecture provient d'une requête `$queryRaw`, jamais d'un `findUnique` non verrouillé. */
interface LockedBatchRow {
  status: BatchStatus;
  currentStep: BatchStep | null;
  reservedLotNumber: string | null;
  startedAt: Date | null;
  plannedQuantity: number;
}

/** Forme minimale de la ligne `batches` lue sous verrou pour l'annulation (voir ADR
 * 0010 § Décision 11). */
interface LockedBatchForCancelRow {
  status: BatchStatus;
  reservedLotNumber: string | null;
  reservedExpiryDate: Date | null;
}

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
    private readonly lotNumberGeneratorService: LotNumberGeneratorService,
    private readonly auditLogService: AuditLogService,
  ) {}

  /**
   * Fait progresser le batch à l'étape suivante. Un batch sans étape (`currentStep`
   * `null`, statut `PLANIFIE`) démarre à `PREPARATION` et passe en `EN_COURS` — c'est
   * le "lancement" du batch, désormais implémenté selon ADR 0010 § Décision 10 (voir
   * `launch` ci-dessous : transaction unique, verrou `Batch` avant verrou
   * `LotNumberCounter`, attribution du numéro de lot et de la DDM, AuditLog). Aucun
   * saut ni retour en arrière au-delà : toujours l'étape suivante dans `STEP_ORDER`.
   *
   * Les étapes suivantes (déjà `EN_COURS`) ne consomment aucun stock supplémentaire
   * dans ce modèle (la déduction n'a lieu qu'à la clôture) ni aucune ressource
   * partagée sensible à la concurrence : elles restent un simple `update`, hors
   * transaction, comportement inchangé par cet ADR.
   */
  async advance(siteId: string, batchId: string, userId: string): Promise<Batch> {
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
      return this.launch(siteId, batchId, userId);
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

  /**
   * Lancement transactionnel `PLANIFIE → EN_COURS` (voir ADR 0010 § Décision 10) :
   * verrouille `Batch` (`SELECT ... FOR UPDATE`, sans filtre sur `status` dans le
   * `WHERE` — uniquement `id`/`siteId`, pour éviter qu'une réévaluation de clause sous
   * verrou ne fasse disparaître la ligne, voir § Décision 18), revalide sous verrou,
   * vérifie la faisabilité et réserve le numéro de lot **dans la même transaction**
   * avant toute écriture, calcule la DDM, écrit `Batch` et journalise — tout, y
   * compris le verrou `LotNumberCounter` (acquis à l'intérieur de
   * `reserveLotNumber`), dans ce seul `tx`. Un second appel concurrent sur le même
   * batch attend le verrou `Batch`, relit l'état réellement à jour une fois débloqué
   * (`READ COMMITTED`/`EvalPlanQual`), et échoue explicitement avant même d'atteindre
   * le verrou du compteur : aucun second numéro n'est jamais consommé.
   */
  private async launch(
    siteId: string,
    batchId: string,
    userId: string,
  ): Promise<Batch> {
    return this.prisma.$transaction(async (tx) => {
      const lockedRows = await tx.$queryRaw<LockedBatchRow[]>`
        SELECT
          status,
          current_step AS "currentStep",
          reserved_lot_number AS "reservedLotNumber",
          started_at AS "startedAt",
          planned_quantity AS "plannedQuantity"
        FROM batches
        WHERE id = ${batchId} AND site_id = ${siteId}
        FOR UPDATE
      `;
      const locked = lockedRows[0];
      if (!locked) {
        throw new NotFoundException(`Batch ${batchId} introuvable.`);
      }
      if (
        locked.status !== BatchStatus.PLANIFIE ||
        locked.currentStep !== null ||
        locked.reservedLotNumber !== null
      ) {
        throw new BadRequestException('Ce batch a déjà été lancé.');
      }

      const allocations = await tx.batchProductAllocation.findMany({
        where: { batchId },
        select: { plannedQuantity: true },
      });
      this.assertAllocationsConsistent({
        plannedQuantity: locked.plannedQuantity,
        allocations,
      });

      const feasibility = await this.batchFeasibilityService.checkFeasibility(
        siteId,
        batchId,
        tx,
      );
      if (!feasibility.isFeasible) {
        throw new BadRequestException(
          'Ce batch ne peut pas être lancé car les stocks sont insuffisants.',
        );
      }

      // Réservation du numéro de lot — mécanisme nominal ADR 0010 uniquement.
      // `generate()` (repli legacy) n'est jamais appelé depuis ce nouveau flux.
      const reservedLotNumber =
        await this.lotNumberGeneratorService.reserveLotNumber(
          siteId,
          batchId,
          tx,
        );

      const startedAt = locked.startedAt ?? new Date();
      const reservedExpiryDate = computeReservedExpiryDate(startedAt);

      const updatedBatch = await tx.batch.update({
        where: { id: batchId },
        data: {
          currentStep: BatchStep.PREPARATION,
          status: BatchStatus.EN_COURS,
          startedAt,
          reservedLotNumber,
          reservedExpiryDate,
        },
      });

      await this.auditLogService.record(
        {
          userId,
          action: AuditAction.UPDATE,
          entity: 'Batch',
          entityId: batchId,
          before: {
            status: BatchStatus.PLANIFIE,
            reservedLotNumber: null,
            reservedExpiryDate: null,
          },
          after: {
            status: BatchStatus.EN_COURS,
            reservedLotNumber,
            reservedExpiryDate: reservedExpiryDate.toISOString(),
          },
        },
        tx,
      );

      return updatedBatch;
    });
  }

  /**
   * Annulation d'un batch (voir ADR 0010 § Décision 11) : `PLANIFIE → ANNULE` (aucun
   * numéro n'a jamais été attribué, rien à libérer) ou `EN_COURS → ANNULE` (libération
   * conditionnelle du numéro réservé, voir `LotNumberGeneratorService.releaseLotNumber`
   * — réutilisable seulement s'il s'agit très exactement du dernier numéro émis pour
   * ce batch, jamais un numéro intermédiaire déjà dépassé). `ANNULE → ANNULE` et
   * `TERMINE → ANNULE` sont refusés explicitement — aucune transition n'est devinée.
   *
   * Verrouille `Batch` (`SELECT ... FOR UPDATE`) avant tout accès à
   * `LotNumberCounter` (acquis à l'intérieur de `releaseLotNumber`, § Décision 8),
   * revalide sous verrou, puis journalise dans la même transaction. Un second appel
   * concurrent sur le même batch attend le verrou `Batch`, relit l'état réellement à
   * jour une fois débloqué, et échoue explicitement s'il constate que le batch n'est
   * plus dans un état annulable : aucun double accès au compteur n'est jamais
   * possible.
   */
  async cancel(siteId: string, batchId: string, userId: string): Promise<Batch> {
    return this.prisma.$transaction(async (tx) => {
      const lockedRows = await tx.$queryRaw<LockedBatchForCancelRow[]>`
        SELECT
          status,
          reserved_lot_number AS "reservedLotNumber",
          reserved_expiry_date AS "reservedExpiryDate"
        FROM batches
        WHERE id = ${batchId} AND site_id = ${siteId}
        FOR UPDATE
      `;
      const locked = lockedRows[0];
      if (!locked) {
        throw new NotFoundException(`Batch ${batchId} introuvable.`);
      }

      if (locked.status === BatchStatus.ANNULE) {
        throw new BadRequestException('Ce batch est déjà annulé.');
      }
      if (locked.status === BatchStatus.TERMINE) {
        throw new BadRequestException(
          'Impossible d’annuler un batch déjà terminé.',
        );
      }

      const hasReservedLotNumber = locked.reservedLotNumber !== null;
      const hasReservedExpiryDate = locked.reservedExpiryDate !== null;
      if (hasReservedLotNumber !== hasReservedExpiryDate) {
        // État normalement rendu impossible par le CHECK PostgreSQL de co-nullabilité
        // (voir ADR 0010 § Décision 2) — défense en profondeur explicite côté service,
        // jamais une tentative de réparation silencieuse (§ Décision 11).
        throw new BadRequestException(
          'État de réservation incohérent pour ce batch ; contactez un administrateur.',
        );
      }

      let lotNumberReusable: boolean | null = null;
      if (locked.status === BatchStatus.EN_COURS && hasReservedLotNumber) {
        lotNumberReusable =
          await this.lotNumberGeneratorService.releaseLotNumber(
            siteId,
            batchId,
            locked.reservedLotNumber!,
            tx,
          );
      }
      // PLANIFIE (jamais réservé) ou EN_COURS legacy (les deux champs NULL, § Décision
      // 14) : aucun accès au compteur, rien à libérer.

      const updatedBatch = await tx.batch.update({
        where: { id: batchId },
        data: {
          status: BatchStatus.ANNULE,
          reservedLotNumber: null,
          reservedExpiryDate: null,
        },
      });

      await this.auditLogService.record(
        {
          userId,
          action: AuditAction.UPDATE,
          entity: 'Batch',
          entityId: batchId,
          before: {
            status: locked.status,
            reservedLotNumber: locked.reservedLotNumber,
            reservedExpiryDate: locked.reservedExpiryDate?.toISOString() ?? null,
          },
          after: {
            status: BatchStatus.ANNULE,
            reservedLotNumber: null,
            reservedExpiryDate: null,
            ...(lotNumberReusable !== null ? { lotNumberReusable } : {}),
          },
        },
        tx,
      );

      return updatedBatch;
    });
  }

  /**
   * Contrôle défensif de cohérence (voir plan-developpement.md, PRD-11) : un batch
   * sans aucune allocation est un batch antérieur à PRD-11 (aucun backfill, jamais
   * bloquant — voir ADR 0006) ; en revanche, dès qu'au moins une allocation existe,
   * la somme de leurs `plannedQuantity` doit toujours égaler `Batch.plannedQuantity`
   * (invariant garanti à l'écriture par `BatchProductAllocationsService`/
   * `BatchesService.updatePlannedQuantity`) — une divergence signale une incohérence
   * réelle, jamais un état historique légitime.
   */
  private assertAllocationsConsistent(batch: {
    plannedQuantity: number;
    allocations: { plannedQuantity: number }[];
  }): void {
    if (batch.allocations.length === 0) {
      return;
    }
    const totalAllocated = batch.allocations.reduce(
      (sum, allocation) => sum + allocation.plannedQuantity,
      0,
    );
    if (totalAllocated !== batch.plannedQuantity) {
      throw new BadRequestException(
        'Les allocations de ce batch ne correspondent plus à sa quantité planifiée ; contactez un administrateur.',
      );
    }
  }
}
