import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { BatchStepsService } from './batch-steps.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BatchFeasibilityService } from '../../batching/batch-feasibility/batch-feasibility.service';
import { LotNumberGeneratorService } from '../lot-number-generator/lot-number-generator.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import {
  AuditAction,
  BatchStatus,
  BatchStep,
} from '../../../generated/prisma/client';

describe('BatchStepsService', () => {
  let service: BatchStepsService;
  let prisma: {
    batch: {
      findFirst: jest.Mock;
      update: jest.Mock<Promise<unknown>, [Record<string, unknown>]>;
    };
    $transaction: jest.Mock;
  };
  let batchFeasibilityService: { checkFeasibility: jest.Mock };
  let lotNumberGeneratorService: {
    reserveLotNumber: jest.Mock;
    releaseLotNumber: jest.Mock;
  };
  let auditLogService: { record: jest.Mock };
  let tx: {
    $queryRaw: jest.Mock;
    batchProductAllocation: { findMany: jest.Mock };
    batch: { update: jest.Mock };
  };

  const siteId = 'site-1';
  const batchId = 'batch-1';
  const userId = 'user-1';

  const baseBatch = {
    id: batchId,
    siteId,
    recipeId: 'recipe-1',
    status: BatchStatus.PLANIFIE,
    currentStep: null as BatchStep | null,
    startedAt: null as Date | null,
    plannedQuantity: 500,
  };

  const feasible = {
    isFeasible: true,
    requestedQuantity: 500,
    shortages: [],
    maxFeasibleQuantity: null,
  };

  /** État verrouillé par défaut (`$queryRaw` sous FOR UPDATE) : un batch PLANIFIE
   * fraîchement créé, jamais encore réservé — voir ADR 0010 § Décision 10 étape 3. */
  function lockedRow(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      status: BatchStatus.PLANIFIE,
      currentStep: null,
      reservedLotNumber: null,
      startedAt: null,
      plannedQuantity: 500,
      ...overrides,
    };
  }

  beforeEach(async () => {
    tx = {
      $queryRaw: jest.fn().mockResolvedValue([lockedRow()]),
      batchProductAllocation: { findMany: jest.fn().mockResolvedValue([]) },
      batch: { update: jest.fn().mockResolvedValue({}) },
    };

    prisma = {
      batch: {
        findFirst: jest.fn(),
        update: jest.fn<Promise<unknown>, [Record<string, unknown>]>(),
      },
      $transaction: jest.fn((callback: (tx: unknown) => unknown) =>
        callback(tx),
      ),
    };
    batchFeasibilityService = {
      checkFeasibility: jest.fn().mockResolvedValue(feasible),
    };
    lotNumberGeneratorService = {
      reserveLotNumber: jest.fn().mockResolvedValue('456149'),
      releaseLotNumber: jest.fn().mockResolvedValue(true),
    };
    auditLogService = { record: jest.fn().mockResolvedValue({}) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BatchStepsService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: BatchFeasibilityService,
          useValue: batchFeasibilityService,
        },
        {
          provide: LotNumberGeneratorService,
          useValue: lotNumberGeneratorService,
        },
        { provide: AuditLogService, useValue: auditLogService },
      ],
    }).compile();

    service = module.get(BatchStepsService);
  });

  it('lève NotFoundException si le batch est introuvable sur ce site', async () => {
    prisma.batch.findFirst.mockResolvedValue(null);

    await expect(service.advance(siteId, batchId, userId)).rejects.toThrow(
      NotFoundException,
    );
  });

  it.each([BatchStatus.TERMINE, BatchStatus.ANNULE])(
    'rejette la progression d’un batch au statut %s, sans jamais ouvrir de transaction',
    async (status) => {
      prisma.batch.findFirst.mockResolvedValue({ ...baseBatch, status });

      await expect(service.advance(siteId, batchId, userId)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );

  describe('lancement (PLANIFIE → EN_COURS, transactionnel)', () => {
    beforeEach(() => {
      prisma.batch.findFirst.mockResolvedValue(baseBatch);
    });

    it('verrouille le Batch via $queryRaw FOR UPDATE, sans filtre sur le statut dans le WHERE', async () => {
      await service.advance(siteId, batchId, userId);

      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      const [sqlParts] = tx.$queryRaw.mock.calls[0] as [
        TemplateStringsArray,
        ...unknown[],
      ];
      const sqlText = sqlParts.join('');
      expect(sqlText).toContain('FOR UPDATE');
      expect(sqlText).not.toContain('status =');
    });

    it('réserve le numéro via reserveLotNumber(siteId, batchId, tx) — jamais generate()', async () => {
      await service.advance(siteId, batchId, userId);

      expect(lotNumberGeneratorService.reserveLotNumber).toHaveBeenCalledWith(
        siteId,
        batchId,
        tx,
      );
    });

    it('écrit reservedLotNumber, reservedExpiryDate (lancement + 3 ans), status et currentStep dans la même transaction', async () => {
      const startedAtBefore = Date.now();
      await service.advance(siteId, batchId, userId);
      const startedAtAfter = Date.now();

      expect(tx.batch.update).toHaveBeenCalledTimes(1);
      const updateArgs = tx.batch.update.mock.calls[0][0] as {
        where: { id: string };
        data: {
          currentStep: BatchStep;
          status: BatchStatus;
          startedAt: Date;
          reservedLotNumber: string;
          reservedExpiryDate: Date;
        };
      };
      expect(updateArgs.where).toEqual({ id: batchId });
      expect(updateArgs.data.currentStep).toBe(BatchStep.PREPARATION);
      expect(updateArgs.data.status).toBe(BatchStatus.EN_COURS);
      expect(updateArgs.data.reservedLotNumber).toBe('456149');
      expect(updateArgs.data.startedAt.getTime()).toBeGreaterThanOrEqual(
        startedAtBefore,
      );
      expect(updateArgs.data.startedAt.getTime()).toBeLessThanOrEqual(
        startedAtAfter,
      );
      // DDM = date de lancement + 3 ans calendaires (ADR 0010 § Décision 12).
      expect(updateArgs.data.reservedExpiryDate.getUTCFullYear()).toBe(
        updateArgs.data.startedAt.getUTCFullYear() + 3,
      );
    });

    it('ne réécrase pas startedAt si déjà défini sous verrou, mais calcule la DDM à partir de cette valeur', async () => {
      const existingStart = new Date('2026-07-01T08:00:00.000Z');
      tx.$queryRaw.mockResolvedValue([
        lockedRow({ startedAt: existingStart }),
      ]);

      await service.advance(siteId, batchId, userId);

      const updateArgs = tx.batch.update.mock.calls[0][0] as {
        data: { startedAt: Date; reservedExpiryDate: Date };
      };
      expect(updateArgs.data.startedAt).toBe(existingStart);
      expect(updateArgs.data.reservedExpiryDate.toISOString()).toBe(
        '2029-07-01T08:00:00.000Z',
      );
    });

    it('journalise l’attribution via AuditLogService.record avec le même tx', async () => {
      await service.advance(siteId, batchId, userId);

      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          action: AuditAction.UPDATE,
          entity: 'Batch',
          entityId: batchId,
          after: expect.objectContaining({
            status: BatchStatus.EN_COURS,
            reservedLotNumber: '456149',
          }),
        }),
        tx,
      );
    });

    it('vérifie la faisabilité via le client transactionnel avant de réserver un numéro', async () => {
      await service.advance(siteId, batchId, userId);

      expect(batchFeasibilityService.checkFeasibility).toHaveBeenCalledWith(
        siteId,
        batchId,
        tx,
      );
    });

    it('rejette le lancement si les stocks sont insuffisants, sans jamais réserver de numéro ni écrire le batch', async () => {
      batchFeasibilityService.checkFeasibility.mockResolvedValue({
        ...feasible,
        isFeasible: false,
      });

      await expect(service.advance(siteId, batchId, userId)).rejects.toThrow(
        'Ce batch ne peut pas être lancé car les stocks sont insuffisants.',
      );
      expect(lotNumberGeneratorService.reserveLotNumber).not.toHaveBeenCalled();
      expect(tx.batch.update).not.toHaveBeenCalled();
      expect(auditLogService.record).not.toHaveBeenCalled();
    });

    it('autorise le lancement quand la somme des allocations correspond à la quantité planifiée', async () => {
      tx.batchProductAllocation.findMany.mockResolvedValue([
        { plannedQuantity: 300 },
        { plannedQuantity: 200 },
      ]);

      await service.advance(siteId, batchId, userId);

      expect(batchFeasibilityService.checkFeasibility).toHaveBeenCalled();
      expect(tx.batch.update).toHaveBeenCalled();
    });

    it('bloque le lancement quand la somme des allocations diverge de la quantité planifiée, sans jamais appeler checkFeasibility ni réserver de numéro', async () => {
      tx.batchProductAllocation.findMany.mockResolvedValue([
        { plannedQuantity: 300 },
        { plannedQuantity: 150 },
      ]);

      await expect(service.advance(siteId, batchId, userId)).rejects.toThrow(
        BadRequestException,
      );
      expect(batchFeasibilityService.checkFeasibility).not.toHaveBeenCalled();
      expect(lotNumberGeneratorService.reserveLotNumber).not.toHaveBeenCalled();
      expect(tx.batch.update).not.toHaveBeenCalled();
    });

    it.each([
      ['status déjà EN_COURS', lockedRow({ status: BatchStatus.EN_COURS })],
      [
        'currentStep déjà renseigné',
        lockedRow({ currentStep: BatchStep.PREPARATION }),
      ],
      [
        'reservedLotNumber déjà renseigné',
        lockedRow({ reservedLotNumber: '456150' }),
      ],
    ])(
      'revalidation sous verrou en échec (%s) → rejet explicite, aucun numéro consommé',
      async (_label, row) => {
        tx.$queryRaw.mockResolvedValue([row]);

        await expect(service.advance(siteId, batchId, userId)).rejects.toThrow(
          'Ce batch a déjà été lancé.',
        );
        expect(batchFeasibilityService.checkFeasibility).not.toHaveBeenCalled();
        expect(
          lotNumberGeneratorService.reserveLotNumber,
        ).not.toHaveBeenCalled();
        expect(tx.batch.update).not.toHaveBeenCalled();
      },
    );

    it('lève NotFoundException si la ligne disparaît entre la lecture initiale et le verrou (défensif)', async () => {
      tx.$queryRaw.mockResolvedValue([]);

      await expect(service.advance(siteId, batchId, userId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('progression des étapes suivantes (déjà EN_COURS, hors transaction)', () => {
    it('ne revérifie jamais la faisabilité ni n’ouvre de transaction pour les étapes suivantes', async () => {
      prisma.batch.findFirst.mockResolvedValue({
        ...baseBatch,
        status: BatchStatus.EN_COURS,
        currentStep: BatchStep.PREPARATION,
        startedAt: new Date(),
      });
      prisma.batch.update.mockResolvedValue({});

      await service.advance(siteId, batchId, userId);

      expect(batchFeasibilityService.checkFeasibility).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it.each([
      [BatchStep.PREPARATION, BatchStep.MELANGE],
      [BatchStep.MELANGE, BatchStep.INCORPORATION_TREMIE],
      [BatchStep.INCORPORATION_TREMIE, BatchStep.CONDITIONNEMENT],
    ])(
      'fait progresser %s vers %s dans le bon ordre',
      async (current, expectedNext) => {
        prisma.batch.findFirst.mockResolvedValue({
          ...baseBatch,
          status: BatchStatus.EN_COURS,
          currentStep: current,
          startedAt: new Date(),
        });
        prisma.batch.update.mockResolvedValue({});

        await service.advance(siteId, batchId, userId);

        expect(prisma.batch.update).toHaveBeenCalledWith({
          where: { id: batchId },
          data: { currentStep: expectedNext },
        });
      },
    );

    it('rejette toute tentative de progression au-delà de CONDITIONNEMENT (pas de clôture ici)', async () => {
      prisma.batch.findFirst.mockResolvedValue({
        ...baseBatch,
        status: BatchStatus.EN_COURS,
        currentStep: BatchStep.CONDITIONNEMENT,
      });

      await expect(service.advance(siteId, batchId, userId)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.batch.update).not.toHaveBeenCalled();
    });
  });

  describe('cancel (PLANIFIE/EN_COURS → ANNULE, transactionnel)', () => {
    /** État verrouillé par défaut : un batch EN_COURS avec réservation complète —
     * voir ADR 0010 § Décision 11, cas normal. */
    function cancelLockedRow(overrides: Partial<Record<string, unknown>> = {}) {
      return {
        status: BatchStatus.EN_COURS,
        reservedLotNumber: '456149',
        reservedExpiryDate: new Date('2029-08-24T00:00:00.000Z'),
        ...overrides,
      };
    }

    beforeEach(() => {
      tx.$queryRaw.mockResolvedValue([cancelLockedRow()]);
    });

    it('lève NotFoundException si le batch est introuvable sous verrou', async () => {
      tx.$queryRaw.mockResolvedValue([]);

      await expect(service.cancel(siteId, batchId, userId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it.each([BatchStatus.ANNULE, BatchStatus.TERMINE])(
      'refuse la transition depuis %s, sans toucher au compteur, au batch ni créer d’AuditLog',
      async (status) => {
        tx.$queryRaw.mockResolvedValue([cancelLockedRow({ status })]);

        await expect(service.cancel(siteId, batchId, userId)).rejects.toThrow(
          BadRequestException,
        );
        expect(
          lotNumberGeneratorService.releaseLotNumber,
        ).not.toHaveBeenCalled();
        expect(tx.batch.update).not.toHaveBeenCalled();
        expect(auditLogService.record).not.toHaveBeenCalled();
      },
    );

    it('verrouille le Batch via $queryRaw FOR UPDATE avant tout accès au compteur', async () => {
      await service.cancel(siteId, batchId, userId);

      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      const [sqlParts] = tx.$queryRaw.mock.calls[0] as [
        TemplateStringsArray,
        ...unknown[],
      ];
      expect(sqlParts.join('')).toContain('FOR UPDATE');
    });

    it('PLANIFIE → ANNULE : aucun accès au compteur, écrit ANNULE, AuditLog sans mention de réutilisation', async () => {
      tx.$queryRaw.mockResolvedValue([
        cancelLockedRow({
          status: BatchStatus.PLANIFIE,
          reservedLotNumber: null,
          reservedExpiryDate: null,
        }),
      ]);

      await service.cancel(siteId, batchId, userId);

      expect(lotNumberGeneratorService.releaseLotNumber).not.toHaveBeenCalled();
      expect(tx.batch.update).toHaveBeenCalledWith({
        where: { id: batchId },
        data: {
          status: BatchStatus.ANNULE,
          reservedLotNumber: null,
          reservedExpiryDate: null,
        },
      });
      const auditArgs = auditLogService.record.mock.calls[0][0] as {
        after: Record<string, unknown>;
      };
      expect(auditArgs.after).not.toHaveProperty('lotNumberReusable');
    });

    it('EN_COURS legacy (les deux champs NULL) : annulation autorisée sans aucun accès au compteur', async () => {
      tx.$queryRaw.mockResolvedValue([
        cancelLockedRow({ reservedLotNumber: null, reservedExpiryDate: null }),
      ]);

      await service.cancel(siteId, batchId, userId);

      expect(lotNumberGeneratorService.releaseLotNumber).not.toHaveBeenCalled();
      expect(tx.batch.update).toHaveBeenCalledWith({
        where: { id: batchId },
        data: {
          status: BatchStatus.ANNULE,
          reservedLotNumber: null,
          reservedExpiryDate: null,
        },
      });
    });

    it('EN_COURS, cas normal, dernier numéro : libère via releaseLotNumber(siteId, batchId, reservedLotNumber, tx), AuditLog avec lotNumberReusable:true', async () => {
      lotNumberGeneratorService.releaseLotNumber.mockResolvedValue(true);

      await service.cancel(siteId, batchId, userId);

      expect(lotNumberGeneratorService.releaseLotNumber).toHaveBeenCalledWith(
        siteId,
        batchId,
        '456149',
        tx,
      );
      expect(tx.batch.update).toHaveBeenCalledWith({
        where: { id: batchId },
        data: {
          status: BatchStatus.ANNULE,
          reservedLotNumber: null,
          reservedExpiryDate: null,
        },
      });
      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          before: expect.objectContaining({
            status: BatchStatus.EN_COURS,
            reservedLotNumber: '456149',
          }),
          after: expect.objectContaining({
            status: BatchStatus.ANNULE,
            reservedLotNumber: null,
            reservedExpiryDate: null,
            lotNumberReusable: true,
          }),
        }),
        tx,
      );
    });

    it('EN_COURS, cas normal, numéro intermédiaire déjà dépassé : annulation réussit quand même, AuditLog avec lotNumberReusable:false', async () => {
      lotNumberGeneratorService.releaseLotNumber.mockResolvedValue(false);

      await service.cancel(siteId, batchId, userId);

      expect(tx.batch.update).toHaveBeenCalled();
      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          after: expect.objectContaining({ lotNumberReusable: false }),
        }),
        tx,
      );
    });

    it.each([
      ['reservedLotNumber seul renseigné', { reservedExpiryDate: null }],
      ['reservedExpiryDate seul renseigné', { reservedLotNumber: null }],
    ])(
      'rejette explicitement un état de réservation incohérent (%s), sans toucher au compteur ni créer d’AuditLog',
      async (_label, overrides) => {
        tx.$queryRaw.mockResolvedValue([cancelLockedRow(overrides)]);

        await expect(service.cancel(siteId, batchId, userId)).rejects.toThrow(
          BadRequestException,
        );
        expect(
          lotNumberGeneratorService.releaseLotNumber,
        ).not.toHaveBeenCalled();
        expect(tx.batch.update).not.toHaveBeenCalled();
        expect(auditLogService.record).not.toHaveBeenCalled();
      },
    );
  });
});
