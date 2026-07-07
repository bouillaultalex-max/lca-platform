import { SetMetadata } from '@nestjs/common';

export const REQUIRE_SYSTEM_ADMIN_KEY = 'requireSystemAdmin';

/**
 * Restreint un handler (ou un controller entier) aux utilisateurs ayant
 * `isSystemAdmin: true` — indépendant du rôle métier (`@Roles`). S'utilise avec
 * `SystemAdminGuard`. Sans ce décorateur, un endpoint n'est pas concerné par ce contrôle.
 */
export const RequireSystemAdmin = () =>
  SetMetadata(REQUIRE_SYSTEM_ADMIN_KEY, true);
