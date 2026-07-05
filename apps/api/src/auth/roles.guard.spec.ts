import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { UserRole } from '../../generated/prisma/client';
import { AuthenticatedUser } from './types/authenticated-user';

describe('RolesGuard', () => {
  let reflector: { getAllAndOverride: jest.Mock };
  let guard: RolesGuard;

  const buildContext = (user?: AuthenticatedUser): ExecutionContext =>
    ({
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

  const directionUser: AuthenticatedUser = {
    id: 'user-1',
    siteId: 'site-1',
    fullName: 'Direction',
    email: 'direction@lca-mes.local',
    role: UserRole.DIRECTION,
  };

  const labUser: AuthenticatedUser = {
    id: 'user-2',
    siteId: 'site-1',
    fullName: 'Responsable Labo',
    email: 'labo@lca-mes.local',
    role: UserRole.RESPONSABLE_LABORATOIRE,
  };

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new RolesGuard(reflector as unknown as Reflector);
  });

  it("autorise l'accès si aucun rôle n'est requis sur le handler", () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    expect(guard.canActivate(buildContext(directionUser))).toBe(true);
  });

  it("autorise l'accès si le rôle de l'utilisateur fait partie des rôles requis", () => {
    reflector.getAllAndOverride.mockReturnValue([
      UserRole.RESPONSABLE_LABORATOIRE,
      UserRole.RESPONSABLE_ADJOINT,
    ]);

    expect(guard.canActivate(buildContext(labUser))).toBe(true);
  });

  it("refuse l'accès si le rôle de l'utilisateur ne fait pas partie des rôles requis", () => {
    reflector.getAllAndOverride.mockReturnValue([
      UserRole.RESPONSABLE_LABORATOIRE,
      UserRole.RESPONSABLE_ADJOINT,
    ]);

    expect(() => guard.canActivate(buildContext(directionUser))).toThrow(
      ForbiddenException,
    );
  });

  it("refuse l'accès si aucun utilisateur n'est présent sur la requête alors que des rôles sont requis", () => {
    reflector.getAllAndOverride.mockReturnValue([
      UserRole.RESPONSABLE_LABORATOIRE,
    ]);

    expect(() => guard.canActivate(buildContext(undefined))).toThrow(
      ForbiddenException,
    );
  });
});
