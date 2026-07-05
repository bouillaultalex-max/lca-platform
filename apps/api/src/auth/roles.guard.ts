import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';
import { UserRole } from '../../generated/prisma/client';
import { AuthenticatedUser } from './types/authenticated-user';

/**
 * Doit s'exécuter après `JwtAuthGuard` (qui peuple `request.user`).
 * Si aucun `@Roles(...)` n'est déclaré sur le handler/controller, l'accès est
 * autorisé à tout utilisateur authentifié (pas de restriction par défaut).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<
      UserRole[] | undefined
    >(ROLES_KEY, [context.getHandler(), context.getClass()]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;

    if (!user || !requiredRoles.includes(user.role)) {
      throw new ForbiddenException(
        "Vous n'avez pas les droits nécessaires pour cette action.",
      );
    }

    return true;
  }
}
