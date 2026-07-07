import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './public.decorator';
import { ALLOW_PENDING_PASSWORD_CHANGE_KEY } from './allow-pending-password-change.decorator';
import { PasswordChangeRequiredException } from './password-change-required.exception';
import { AuthenticatedUser } from './types/authenticated-user';

/**
 * Doit s'exécuter après `JwtAuthGuard`. Contrairement à `RolesGuard`/`SystemAdminGuard`
 * (qui ne s'appliquent que si leur décorateur est présent), ce garde s'applique par
 * défaut à **toute** route authentifiée : un utilisateur avec `mustChangePassword`
 * ne peut atteindre que `/auth/login` (`@Public()`) et les routes explicitement
 * marquées `@AllowPendingPasswordChange()`.
 */
@Injectable()
export class MustChangePasswordGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const isAllowed = this.reflector.getAllAndOverride<boolean>(
      ALLOW_PENDING_PASSWORD_CHANGE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isAllowed) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();

    if (request.user?.mustChangePassword) {
      throw new PasswordChangeRequiredException();
    }

    return true;
  }
}
