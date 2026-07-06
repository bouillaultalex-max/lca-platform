import { NotFoundException } from '@nestjs/common';
import { ImportLogsService } from './import-logs.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ImportLog,
  ImportStatus,
  ImportType,
} from '../../../generated/prisma/client';

describe('ImportLogsService', () => {
  let service: ImportLogsService;
  let prisma: {
    importLog: {
      create: jest.Mock<Promise<unknown>, [Record<string, unknown>]>;
      findFirst: jest.Mock<Promise<unknown>, [Record<string, unknown>]>;
      findMany: jest.Mock<Promise<unknown>, [Record<string, unknown>]>;
      update: jest.Mock<Promise<unknown>, [Record<string, unknown>]>;
    };
  };

  const siteId = 'site-1';
  const userId = 'user-1';

  const importLog: ImportLog = {
    id: 'import-log-1',
    siteId,
    type: ImportType.ARTICLES,
    fileName: 'articles.xlsx',
    importedAt: new Date('2026-07-06'),
    status: ImportStatus.PREVISUALISE,
    processedLines: 3,
    errorCount: 1,
    errorDetails: [{ line: 4, message: 'Référence manquante.' }],
    userId,
    createdAt: new Date('2026-07-06'),
    updatedAt: new Date('2026-07-06'),
  };

  beforeEach(() => {
    prisma = {
      importLog: {
        create: jest.fn<Promise<unknown>, [Record<string, unknown>]>(),
        findFirst: jest.fn<Promise<unknown>, [Record<string, unknown>]>(),
        findMany: jest.fn<Promise<unknown>, [Record<string, unknown>]>(),
        update: jest.fn<Promise<unknown>, [Record<string, unknown>]>(),
      },
    };
    service = new ImportLogsService(prisma as unknown as PrismaService);
  });

  describe('createPreview', () => {
    it('crée une entrée avec le statut PREVISUALISE et le détail des erreurs', async () => {
      prisma.importLog.create.mockResolvedValue(importLog);

      const result = await service.createPreview(
        siteId,
        userId,
        ImportType.ARTICLES,
        'articles.xlsx',
        3,
        [{ line: 4, message: 'Référence manquante.' }],
      );

      expect(result).toBe(importLog);
      const call = prisma.importLog.create.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(call.data).toMatchObject({
        siteId,
        userId,
        type: ImportType.ARTICLES,
        fileName: 'articles.xlsx',
        status: ImportStatus.PREVISUALISE,
        processedLines: 3,
        errorCount: 1,
        errorDetails: [{ line: 4, message: 'Référence manquante.' }],
      });
    });

    it("n'enregistre pas de détail d'erreurs quand il n'y en a aucune", async () => {
      prisma.importLog.create.mockResolvedValue(importLog);

      await service.createPreview(
        siteId,
        userId,
        ImportType.ARTICLES,
        'articles.xlsx',
        3,
        [],
      );

      const call = prisma.importLog.create.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(call.data.errorCount).toBe(0);
      expect(call.data.errorDetails).toBeUndefined();
    });
  });

  describe('markValidated', () => {
    it('fait passer le statut à VALIDE', async () => {
      prisma.importLog.findFirst.mockResolvedValue(importLog);
      prisma.importLog.update.mockResolvedValue({
        ...importLog,
        status: ImportStatus.VALIDE,
      });

      const result = await service.markValidated(siteId, importLog.id);

      expect(result.status).toBe(ImportStatus.VALIDE);
      expect(prisma.importLog.update).toHaveBeenCalledWith({
        where: { id: importLog.id },
        data: { status: ImportStatus.VALIDE },
      });
    });

    it("lève une NotFoundException si l'historique n'existe pas pour ce site", async () => {
      prisma.importLog.findFirst.mockResolvedValue(null);

      await expect(
        service.markValidated(siteId, 'introuvable'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAll', () => {
    it('liste les imports du site, du plus récent au plus ancien', async () => {
      prisma.importLog.findMany.mockResolvedValue([importLog]);

      const result = await service.findAll(siteId);

      expect(result).toEqual([importLog]);
      expect(prisma.importLog.findMany).toHaveBeenCalledWith({
        where: { siteId },
        orderBy: { importedAt: 'desc' },
      });
    });

    it('filtre par type quand il est fourni', async () => {
      prisma.importLog.findMany.mockResolvedValue([importLog]);

      await service.findAll(siteId, ImportType.ARTICLES);

      expect(prisma.importLog.findMany).toHaveBeenCalledWith({
        where: { siteId, type: ImportType.ARTICLES },
        orderBy: { importedAt: 'desc' },
      });
    });
  });
});
