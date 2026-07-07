import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_SYSTEM_ADMIN_KEY } from './require-system-admin.decorator';
import { AuthenticatedUser } from './types/authenticated-user';

/**
 * Doit s'exécuter après `JwtAuthGuard`. Si `@RequireSystemAdmin()` n'est pas déclaré
 * sur le handler/controller, cette vérification est ignorée (comportement par défaut
 * identique à `RolesGuard` sans `@Roles(...)`).
 */
@Injectable()
export class SystemAdminGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiresSystemAdmin = this.reflector.getAllAndOverride<boolean>(
      REQUIRE_SYSTEM_ADMIN_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiresSystemAdmin) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();

    if (!request.user?.isSystemAdmin) {
      throw new ForbiddenException('Réservé aux administrateurs système.');
    }

    return true;
  }
}
