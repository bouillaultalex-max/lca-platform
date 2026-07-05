import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedUser } from './types/authenticated-user';

/**
 * Injecte l'utilisateur authentifié (`request.user`, peuplé par JwtStrategy)
 * directement comme paramètre de handler : `@CurrentUser() user: AuthenticatedUser`.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx
      .switchToHttp()
      .getRequest<{ user: AuthenticatedUser }>();
    return request.user;
  },
);
