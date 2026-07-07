import { SetMetadata } from '@nestjs/common';

export const ALLOW_PENDING_PASSWORD_CHANGE_KEY = 'allowPendingPasswordChange';

/**
 * Exempte un endpoint du blocage `MustChangePasswordGuard`. Réservé aux quelques
 * routes qu'un utilisateur avec `mustChangePassword: true` doit pouvoir atteindre
 * malgré tout : `GET /auth/me` (savoir qui il est) et `POST /auth/change-password`
 * (l'action qui débloque tout le reste).
 */
export const AllowPendingPasswordChange = () =>
  SetMetadata(ALLOW_PENDING_PASSWORD_CHANGE_KEY, true);
