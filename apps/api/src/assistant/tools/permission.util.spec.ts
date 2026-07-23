import { ForbiddenException } from '@nestjs/common';
import { assertToolPermission } from './permission.util';
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

describe('assertToolPermission', () => {
  it('autorise tout utilisateur authentifié pour une permission "authenticated"', () => {
    expect(() =>
      assertToolPermission({ kind: 'authenticated' }, buildUser()),
    ).not.toThrow();
  });

  it('autorise un utilisateur dont le rôle figure dans la liste requise', () => {
    expect(() =>
      assertToolPermission(
        { kind: 'roles', roles: [UserRole.RESPONSABLE_LABORATOIRE] },
        buildUser({ role: UserRole.RESPONSABLE_LABORATOIRE }),
      ),
    ).not.toThrow();
  });

  it('refuse un utilisateur dont le rôle ne figure pas dans la liste requise (ex: DIRECTION sur un outil réservé aux rôles complets)', () => {
    expect(() =>
      assertToolPermission(
        { kind: 'roles', roles: [UserRole.RESPONSABLE_LABORATOIRE] },
        buildUser({ role: UserRole.DIRECTION }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('autorise un administrateur système pour une permission "systemAdmin"', () => {
    expect(() =>
      assertToolPermission(
        { kind: 'systemAdmin' },
        buildUser({ isSystemAdmin: true }),
      ),
    ).not.toThrow();
  });

  it('refuse un utilisateur non administrateur système pour une permission "systemAdmin"', () => {
    expect(() =>
      assertToolPermission(
        { kind: 'systemAdmin' },
        buildUser({ isSystemAdmin: false }),
      ),
    ).toThrow(ForbiddenException);
  });
});
