import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { QualityChecksService } from './quality-checks.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import {
  QualityCheckResult,
  QualityCheckType,
} from '../../../generated/prisma/client';

describe('QualityChecksService', () => {
  let service: QualityChecksService;

  let prisma: {
    lot: { findFirst: jest.Mock };
    $transaction: jest.Mock<Promise<unknown>, [(tx: unknown) => unknown]>;
  };
  let tx: {
    qualityCheck: {
      create: jest.Mock<Promise<unknown>, [Record<string, unknown>]>;
      findMany: jest.Mock;
    };
    lot: { update: jest.Mock<Promise<unknown>, [Record<string, unknown>]> };
  };
  let auditLogService: { record: jest.Mock };

  const siteId = 'site-1';
  const userId = 'user-1';
  const lotId = 'lot-1';

  const dto = {
    type: QualityCheckType.VISUEL,
    result: QualityCheckResult.CONFORME,
    checkedAt: '2026-08-17T10:00:00.000Z',
    comment: 'RAS',
  };

  beforeEach(async () => {
    tx = {
      qualityCheck: {
        create: jest.fn<Promise<unknown>, [Record<string, unknown>]>(),
        findMany: jest.fn(),
      },
      lot: { update: jest.fn<Promise<unknown>, [Record<string, unknown>]>() },
    };

    prisma = {
      lot: { findFirst: jest.fn() },
      $transaction: jest.fn<Promise<unknown>, [(tx: unknown) => unknown]>(
        (callback) => Promise.resolve(callback(tx)),
      ),
    };

    auditLogService = { record: jest.fn().mockResolvedValue(undefined) };

    tx.qualityCheck.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: 'check-1',
          createdAt: new Date('2026-08-17T10:05:00.000Z'),
          updatedAt: new Date('2026-08-17T10:05:00.000Z'),
          ...data,
        }),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QualityChecksService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogService, useValue: auditLogService },
      ],
    }).compile();

    service = module.get(QualityChecksService);
  });

  describe('findByLotId', () => {
    it('retourne le lot et ses contrôles qualité pour un lot du site courant', async () => {
      const lot = { id: lotId, siteId, qualityChecks: [] };
      prisma.lot.findFirst.mockResolvedValue(lot);

      const result = await service.findByLotId(siteId, lotId);

      expect(result).toBe(lot);
      expect(prisma.lot.findFirst).toHaveBeenCalledWith({
        where: { id: lotId, siteId },
        include: { qualityChecks: { orderBy: { checkedAt: 'asc' } } },
      });
    });

    it('lève NotFoundException si le lot est introuvable ou appartient à un autre site', async () => {
      prisma.lot.findFirst.mockResolvedValue(null);

      await expect(service.findByLotId(siteId, lotId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('lève NotFoundException si le lot est introuvable ou appartient à un autre site, sans ouvrir de transaction', async () => {
      prisma.lot.findFirst.mockResolvedValue(null);

      await expect(service.create(siteId, userId, lotId, dto)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('crée le QualityCheck et met à jour Lot.qualityStatus dans la même transaction (cas CONFORME)', async () => {
      prisma.lot.findFirst.mockResolvedValue({ id: lotId, siteId });
      tx.qualityCheck.findMany.mockResolvedValue([
        { result: QualityCheckResult.CONFORME },
      ]);

      const result = await service.create(siteId, userId, lotId, dto);

      expect(tx.qualityCheck.create).toHaveBeenCalledWith({
        data: {
          lotId,
          type: dto.type,
          result: dto.result,
          controllerId: userId,
          checkedAt: new Date(dto.checkedAt),
          comment: dto.comment,
        },
      });
      expect(tx.qualityCheck.findMany).toHaveBeenCalledWith({
        where: { lotId },
        select: { result: true },
      });
      expect(tx.lot.update).toHaveBeenCalledWith({
        where: { id: lotId },
        data: { qualityStatus: 'CONFORME' },
      });
      expect(result.id).toBe('check-1');
    });

    it('met à jour Lot.qualityStatus = NON_CONFORME dès qu’un contrôle NON_CONFORME existe parmi tous ceux du lot', async () => {
      prisma.lot.findFirst.mockResolvedValue({ id: lotId, siteId });
      tx.qualityCheck.findMany.mockResolvedValue([
        { result: QualityCheckResult.CONFORME },
        { result: QualityCheckResult.NON_CONFORME },
      ]);

      await service.create(siteId, userId, lotId, {
        ...dto,
        result: QualityCheckResult.NON_CONFORME,
      });

      expect(tx.lot.update).toHaveBeenCalledWith({
        where: { id: lotId },
        data: { qualityStatus: 'NON_CONFORME' },
      });
    });

    it('traite CONFORME_AVEC_RESERVE comme CONFORME pour Lot.qualityStatus', async () => {
      prisma.lot.findFirst.mockResolvedValue({ id: lotId, siteId });
      tx.qualityCheck.findMany.mockResolvedValue([
        { result: QualityCheckResult.CONFORME_AVEC_RESERVE },
      ]);

      await service.create(siteId, userId, lotId, {
        ...dto,
        result: QualityCheckResult.CONFORME_AVEC_RESERVE,
      });

      expect(tx.lot.update).toHaveBeenCalledWith({
        where: { id: lotId },
        data: { qualityStatus: 'CONFORME' },
      });
    });

    it('utilise la date courante si checkedAt est omis', async () => {
      prisma.lot.findFirst.mockResolvedValue({ id: lotId, siteId });
      tx.qualityCheck.findMany.mockResolvedValue([
        { result: QualityCheckResult.CONFORME },
      ]);

      await service.create(siteId, userId, lotId, {
        type: dto.type,
        result: dto.result,
      });

      const callArgs = tx.qualityCheck.create.mock.calls[0][0] as {
        data: { checkedAt: Date };
      };
      expect(callArgs.data.checkedAt).toBeInstanceOf(Date);
    });

    it('journalise la création dans AuditLog après le succès de la transaction', async () => {
      prisma.lot.findFirst.mockResolvedValue({ id: lotId, siteId });
      tx.qualityCheck.findMany.mockResolvedValue([
        { result: QualityCheckResult.CONFORME },
      ]);

      await service.create(siteId, userId, lotId, dto);

      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          action: 'CREATE',
          entity: 'QualityCheck',
          entityId: 'check-1',
        }),
      );
    });

    it('ne journalise rien dans AuditLog si la transaction échoue — le QualityCheck et Lot.qualityStatus restent atomiques', async () => {
      prisma.lot.findFirst.mockResolvedValue({ id: lotId, siteId });
      prisma.$transaction.mockRejectedValueOnce(new Error('échec transaction'));

      await expect(service.create(siteId, userId, lotId, dto)).rejects.toThrow(
        'échec transaction',
      );
      expect(auditLogService.record).not.toHaveBeenCalled();
    });
  });
});
