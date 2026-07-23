import {
  createImportsTools,
  type ImportHistoryEntryToolResult,
} from './imports.tools';
import { FULL_ACCESS_ROLES } from '../../auth/roles.constants';
import type { ImportLogsService } from '../../import-export/import-logs/import-logs.service';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user';
import { UserRole } from '../../../generated/prisma/client';

function buildUser(
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser {
  return {
    id: 'user-1',
    siteId: 'site-1',
    fullName: 'Kevin Prian',
    email: 'kevin.prian@lca-mes.local',
    role: UserRole.RESPONSABLE_ADJOINT,
    jobTitle: null,
    isSystemAdmin: false,
    mustChangePassword: false,
    lastLoginAt: null,
    ...overrides,
  };
}

function buildLogs() {
  const importedAt = new Date('2026-06-15T10:00:00.000Z');
  return Array.from({ length: 15 }, (_, index) => ({
    type: 'ARTICLES',
    importedAt,
    status: 'VALIDE',
    processedLines: 100 + index,
    errorCount: 0,
    fileName: `fichier-${index}.csv`,
    errorDetails: [{ line: 1, message: 'ne doit jamais être exposé' }],
  }));
}

describe('imports.getImportHistory', () => {
  it('applique la même permission que le contrôleur import-logs (FULL_ACCESS_ROLES) et ne renvoie que type/date/statut/lignes/erreurs', async () => {
    const findAll = jest.fn().mockResolvedValue(buildLogs());
    const importLogsService = { findAll } as unknown as ImportLogsService;

    const [getImportHistory] = createImportsTools(importLogsService);
    expect(getImportHistory.name).toBe('imports.getImportHistory');
    expect(getImportHistory.permission).toEqual({
      kind: 'roles',
      roles: FULL_ACCESS_ROLES,
    });

    const result = (await getImportHistory.handler(
      buildUser(),
      {},
    )) as ImportHistoryEntryToolResult[];

    expect(findAll).toHaveBeenCalledWith('site-1');
    expect(result).toHaveLength(10);
    for (const entry of result) {
      expect(Object.keys(entry).sort()).toEqual(
        ['errorCount', 'importedAt', 'processedLines', 'status', 'type'].sort(),
      );
    }
  });

  it('respecte la limite fournie en entrée', async () => {
    const importLogsService = {
      findAll: jest.fn().mockResolvedValue(buildLogs()),
    } as unknown as ImportLogsService;
    const [getImportHistory] = createImportsTools(importLogsService);

    const result = await getImportHistory.handler(buildUser(), { limit: 3 });

    expect(result).toHaveLength(3);
  });
});
