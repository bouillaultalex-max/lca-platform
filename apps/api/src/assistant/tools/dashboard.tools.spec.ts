import { createDashboardTools } from './dashboard.tools';
import type { DashboardService } from '../../dashboard/dashboard.service';
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
    role: UserRole.DIRECTION,
    jobTitle: null,
    isSystemAdmin: false,
    mustChangePassword: false,
    lastLoginAt: null,
    ...overrides,
  };
}

describe('dashboard.tools', () => {
  it('dashboard.getSummary est ouvert à tout utilisateur authentifié et projette exactement les 7 compteurs, rien de plus', async () => {
    const getSummary = jest.fn().mockResolvedValue({
      articlesCount: 10,
      activeRecipesCount: 5,
      activeMachinesCount: 3,
      stockLotsCount: 42,
      openBatchesCount: 2,
      unresolvedFeedbackCount: 1,
      pendingExpectedRequirementsCount: 7,
      // Champ superflu qui ne doit jamais fuiter dans la projection.
      internalDebugField: 'ne doit jamais apparaître',
    });
    const dashboardService = { getSummary } as unknown as DashboardService;

    const [tool] = createDashboardTools(dashboardService);
    expect(tool.name).toBe('dashboard.getSummary');
    expect(tool.permission).toEqual({ kind: 'authenticated' });

    const user = buildUser();
    const result = await tool.handler(user, {});

    expect(getSummary).toHaveBeenCalledWith('site-1');
    expect(result).toEqual({
      articlesCount: 10,
      activeRecipesCount: 5,
      activeMachinesCount: 3,
      stockLotsCount: 42,
      openBatchesCount: 2,
      unresolvedFeedbackCount: 1,
      pendingExpectedRequirementsCount: 7,
    });
    expect(result).not.toHaveProperty('internalDebugField');
  });
});
