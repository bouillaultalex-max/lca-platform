import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SystemAdminGuard } from './system-admin.guard';
import { UserRole } from '../../generated/prisma/client';
import { AuthenticatedUser } from './types/authenticated-user';

describe('SystemAdminGuard', () => {
  let reflector: { getAllAndOverride: jest.Mock };
  let guard: SystemAdminGuard;

  const buildContext = (user?: AuthenticatedUser): ExecutionContext =>
    ({
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

  const admin: AuthenticatedUser = {
    id: 'user-1',
    siteId: 'site-1',
    fullName: 'Alexandre Bouillault',
    email: 'alexandre@lca-mes.local',
    role: UserRole.RESPONSABLE_ADJOINT,
    jobTitle: null,
    isSystemAdmin: true,
    mustChangePassword: false,
    lastLoginAt: null,
  };

  const nonAdmin: AuthenticatedUser = {
    id: 'user-2',
    siteId: 'site-1',
    fullName: 'Kevin Prian',
    email: 'kevin@lca-mes.local',
    role: UserRole.RESPONSABLE_LABORATOIRE,
    jobTitle: null,
    isSystemAdmin: false,
    mustChangePassword: false,
    lastLoginAt: null,
  };

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new SystemAdminGuard(reflector as unknown as Reflector);
  });

  it("autorise l'accès si @RequireSystemAdmin() n'est pas déclaré", () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    expect(guard.canActivate(buildContext(nonAdmin))).toBe(true);
  });

  it('autorise un utilisateur avec isSystemAdmin: true', () => {
    reflector.getAllAndOverride.mockReturnValue(true);

    expect(guard.canActivate(buildContext(admin))).toBe(true);
  });

  it('refuse un utilisateur sans isSystemAdmin, même avec un rôle métier à accès complet', () => {
    reflector.getAllAndOverride.mockReturnValue(true);

    expect(() => guard.canActivate(buildContext(nonAdmin))).toThrow(
      ForbiddenException,
    );
  });

  it("refuse l'accès si aucun utilisateur n'est présent sur la requête", () => {
    reflector.getAllAndOverride.mockReturnValue(true);

    expect(() => guard.canActivate(buildContext(undefined))).toThrow(
      ForbiddenException,
    );
  });
});
