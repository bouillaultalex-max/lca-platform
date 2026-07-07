import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MustChangePasswordGuard } from './must-change-password.guard';
import { PasswordChangeRequiredException } from './password-change-required.exception';
import { UserRole } from '../../generated/prisma/client';
import { AuthenticatedUser } from './types/authenticated-user';

describe('MustChangePasswordGuard', () => {
  let reflector: { getAllAndOverride: jest.Mock };
  let guard: MustChangePasswordGuard;

  const buildContext = (user?: AuthenticatedUser): ExecutionContext =>
    ({
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

  const pendingUser: AuthenticatedUser = {
    id: 'user-1',
    siteId: 'site-1',
    fullName: 'Kevin Prian',
    email: 'kevin@lca-mes.local',
    role: UserRole.RESPONSABLE_LABORATOIRE,
    jobTitle: null,
    isSystemAdmin: false,
    mustChangePassword: true,
    lastLoginAt: null,
  };

  const normalUser: AuthenticatedUser = {
    ...pendingUser,
    mustChangePassword: false,
  };

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new MustChangePasswordGuard(reflector as unknown as Reflector);
  });

  it('autorise toujours les routes @Public()', () => {
    reflector.getAllAndOverride.mockReturnValueOnce(true); // IS_PUBLIC_KEY

    expect(guard.canActivate(buildContext(pendingUser))).toBe(true);
  });

  it('autorise les routes @AllowPendingPasswordChange() malgré mustChangePassword', () => {
    reflector.getAllAndOverride
      .mockReturnValueOnce(undefined) // IS_PUBLIC_KEY
      .mockReturnValueOnce(true); // ALLOW_PENDING_PASSWORD_CHANGE_KEY

    expect(guard.canActivate(buildContext(pendingUser))).toBe(true);
  });

  it('bloque toute autre route tant que mustChangePassword est vrai', () => {
    reflector.getAllAndOverride
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(undefined);

    expect(() => guard.canActivate(buildContext(pendingUser))).toThrow(
      PasswordChangeRequiredException,
    );
  });

  it('autorise un utilisateur normal (mustChangePassword: false)', () => {
    reflector.getAllAndOverride
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(undefined);

    expect(guard.canActivate(buildContext(normalUser))).toBe(true);
  });
});
