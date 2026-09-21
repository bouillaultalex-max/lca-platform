import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  UserAdminService,
  UserAdminView,
  UserAuditLogEntryView,
} from './user-admin.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AuditLogService,
  RecordAuditLogParams,
} from '../../audit-log/audit-log.service';
import { UserRole } from '../../../generated/prisma/client';

describe('UserAdminService', () => {
  let service: UserAdminService;
  let prisma: {
    user: {
      findMany: jest.Mock<Promise<unknown>, [Record<string, unknown>]>;
      findFirst: jest.Mock<Promise<unknown>, [Record<string, unknown>]>;
      create: jest.Mock<Promise<unknown>, [Record<string, unknown>]>;
      update: jest.Mock<Promise<unknown>, [Record<string, unknown>]>;
    };
    auditLog: {
      findMany: jest.Mock<Promise<unknown>, [Record<string, unknown>]>;
    };
  };
  let auditLogService: {
    record: jest.Mock<Promise<unknown>, [RecordAuditLogParams]>;
  };

  const siteId = 'site-1';
  const actingUserId = 'admin-1';

  const kevin: UserAdminView = {
    id: 'user-2',
    siteId,
    fullName: 'Kevin Prian',
    email: 'kevin.prian@lca-mes.local',
    role: UserRole.RESPONSABLE_LABORATOIRE,
    isSystemAdmin: false,
    mustChangePassword: true,
    lastLoginAt: null,
    active: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    jobTitle: { id: 'job-1', name: 'Responsable laboratoire' },
  };

  beforeEach(async () => {
    prisma = {
      user: {
        findMany: jest.fn<Promise<unknown>, [Record<string, unknown>]>(),
        findFirst: jest.fn<Promise<unknown>, [Record<string, unknown>]>(),
        create: jest.fn<Promise<unknown>, [Record<string, unknown>]>(),
        update: jest.fn<Promise<unknown>, [Record<string, unknown>]>(),
      },
      auditLog: {
        findMany: jest.fn<Promise<unknown>, [Record<string, unknown>]>(),
      },
    };
    auditLogService = {
      record: jest.fn<Promise<unknown>, [RecordAuditLogParams]>(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserAdminService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogService, useValue: auditLogService },
      ],
    }).compile();

    service = module.get(UserAdminService);
  });

  describe('create', () => {
    it('crée un compte avec mustChangePassword forcé et retourne un mot de passe temporaire en clair une seule fois', async () => {
      prisma.user.create.mockResolvedValue(kevin);

      const result = await service.create(
        siteId,
        {
          fullName: kevin.fullName,
          email: kevin.email,
          jobTitleId: 'job-1',
          role: kevin.role,
        },
        actingUserId,
      );

      const createCallArgs = prisma.user.create.mock.calls[0][0];
      expect(createCallArgs).toMatchObject({
        data: { siteId, mustChangePassword: true, isSystemAdmin: false },
      });
      expect(typeof result.temporaryPassword).toBe('string');
      expect(result.temporaryPassword.length).toBeGreaterThan(0);
      expect(result.user).toEqual(kevin);

      // Le mot de passe en clair ne doit jamais être transmis à l'audit log.
      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE', entity: 'User' }),
      );
      const auditCallArgs = auditLogService.record.mock.calls[0][0];
      expect(JSON.stringify(auditCallArgs)).not.toContain(
        result.temporaryPassword,
      );
    });
  });

  describe('update', () => {
    it('empêche un administrateur de retirer son propre statut isSystemAdmin', async () => {
      await expect(
        service.update(
          siteId,
          actingUserId,
          { isSystemAdmin: false },
          actingUserId,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('autorise un administrateur à modifier ses propres informations sans toucher isSystemAdmin', async () => {
      prisma.user.findFirst.mockResolvedValue(kevin);
      prisma.user.update.mockResolvedValue(kevin);

      await expect(
        service.update(
          siteId,
          actingUserId,
          { fullName: 'Nouveau nom' },
          actingUserId,
        ),
      ).resolves.toBeDefined();
    });

    it("modifie un autre compte, y compris l'e-mail, et journalise l'action", async () => {
      prisma.user.findFirst.mockResolvedValue(kevin);
      const updated = { ...kevin, email: 'kevin.prian.nouveau@lca-mes.local' };
      prisma.user.update.mockResolvedValue(updated);

      const result = await service.update(
        siteId,
        kevin.id,
        { email: 'kevin.prian.nouveau@lca-mes.local' },
        actingUserId,
      );

      const updateCallArgs = prisma.user.update.mock.calls[0][0];
      expect(updateCallArgs).toMatchObject({
        where: { id: kevin.id },
        data: { email: 'kevin.prian.nouveau@lca-mes.local' },
      });
      expect(result.email).toBe('kevin.prian.nouveau@lca-mes.local');
      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'UPDATE', entity: 'User' }),
      );
    });

    it('modifie le rôle et journalise le rôle avant/après dans AuditLog', async () => {
      prisma.user.findFirst.mockResolvedValue(kevin);
      const updated = { ...kevin, role: UserRole.DAF };
      prisma.user.update.mockResolvedValue(updated);

      const result = await service.update(
        siteId,
        kevin.id,
        { role: UserRole.DAF },
        actingUserId,
      );

      expect(result.role).toBe(UserRole.DAF);
      const auditCallArgs = auditLogService.record.mock.calls[0][0];
      expect(auditCallArgs).toMatchObject({
        action: 'UPDATE',
        entity: 'User',
        entityId: kevin.id,
        userId: actingUserId,
      });
      expect(auditCallArgs.before).toMatchObject({
        role: UserRole.RESPONSABLE_LABORATOIRE,
      });
      expect(auditCallArgs.after).toMatchObject({ role: UserRole.DAF });
    });

    it("lève NotFoundException si l'utilisateur cible n'existe pas sur ce site, sans écrire", async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.update(siteId, 'inconnu', { role: UserRole.DAF }, actingUserId),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(auditLogService.record).not.toHaveBeenCalled();
    });
  });

  describe('deactivate', () => {
    it('empêche un administrateur de désactiver son propre compte', async () => {
      await expect(
        service.deactivate(siteId, actingUserId, actingUserId),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it("désactive un autre compte et journalise l'action", async () => {
      prisma.user.findFirst.mockResolvedValue(kevin);
      prisma.user.update.mockResolvedValue({ ...kevin, active: false });

      const result = await service.deactivate(siteId, kevin.id, actingUserId);

      const updateCallArgs = prisma.user.update.mock.calls[0][0];
      expect(updateCallArgs).toMatchObject({
        where: { id: kevin.id },
        data: { active: false },
      });
      expect(result.active).toBe(false);
      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DELETE', entity: 'User' }),
      );
    });

    it("lève NotFoundException si l'utilisateur cible n'existe pas sur ce site", async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.deactivate(siteId, 'inconnu', actingUserId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getAuditLog', () => {
    it("lève NotFoundException si l'utilisateur cible n'existe pas sur ce site", async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(service.getAuditLog(siteId, 'inconnu')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
    });

    it("retourne l'historique filtré sur l'utilisateur, trié du plus récent au plus ancien", async () => {
      prisma.user.findFirst.mockResolvedValue(kevin);
      const entries: UserAuditLogEntryView[] = [
        {
          id: 'audit-2',
          action: 'UPDATE',
          before: { role: 'DAF' },
          after: { role: 'RESPONSABLE_LABORATOIRE' },
          createdAt: new Date('2026-02-01'),
          user: { id: actingUserId, fullName: 'Admin' },
        },
        {
          id: 'audit-1',
          action: 'CREATE',
          before: null,
          after: { role: 'DAF' },
          createdAt: new Date('2026-01-01'),
          user: { id: actingUserId, fullName: 'Admin' },
        },
      ];
      prisma.auditLog.findMany.mockResolvedValue(entries);

      const result = await service.getAuditLog(siteId, kevin.id);

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { entity: 'User', entityId: kevin.id },
          orderBy: { createdAt: 'desc' },
        }),
      );
      expect(result).toEqual(entries);
    });

    it("ne retourne jamais l'historique d'un compte d'un autre site (borné par findOne)", async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(service.getAuditLog('autre-site', kevin.id)).rejects.toThrow(
        NotFoundException,
      );
      const findFirstArgs = prisma.user.findFirst.mock.calls[0][0];
      expect(findFirstArgs).toMatchObject({
        where: { id: kevin.id, siteId: 'autre-site' },
      });
    });
  });

  describe('resetPassword', () => {
    it('génère un nouveau mot de passe temporaire et force mustChangePassword sans journaliser le mot de passe en clair', async () => {
      prisma.user.findFirst.mockResolvedValue(kevin);
      prisma.user.update.mockResolvedValue({
        ...kevin,
        mustChangePassword: true,
      });

      const result = await service.resetPassword(
        siteId,
        kevin.id,
        actingUserId,
      );

      const updateCallArgs = prisma.user.update.mock.calls[0][0];
      expect(updateCallArgs).toMatchObject({
        where: { id: kevin.id },
        data: { mustChangePassword: true },
      });
      expect(typeof result.temporaryPassword).toBe('string');
      const auditCallArgs = auditLogService.record.mock.calls[0][0];
      expect(JSON.stringify(auditCallArgs)).not.toContain(
        result.temporaryPassword,
      );
    });
  });
});
