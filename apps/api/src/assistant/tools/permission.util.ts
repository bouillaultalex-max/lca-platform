import { ForbiddenException } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user';
import type { ToolPermission } from './tool.types';

/**
 * Vérifie qu'un utilisateur a le droit d'exécuter un outil, en reproduisant
 * exactement la même logique que les guards HTTP existants (RolesGuard,
 * SystemAdminGuard) — nécessaire car l'exécution d'un outil ne passe jamais par
 * la couche HTTP/guards (les handlers appellent directement les services, voir
 * tool.types.ts). Lève une `ForbiddenException` explicite si la permission est
 * refusée : jamais un simple booléen silencieux, jamais déduit du texte produit
 * par le modèle (voir AI-01 §13).
 */
export function assertToolPermission(
  permission: ToolPermission,
  user: AuthenticatedUser,
): void {
  switch (permission.kind) {
    case 'authenticated':
      return;
    case 'roles':
      if (!permission.roles.includes(user.role)) {
        throw new ForbiddenException(
          "Vous n'avez pas les droits nécessaires pour utiliser cet outil.",
        );
      }
      return;
    case 'systemAdmin':
      if (!user.isSystemAdmin) {
        throw new ForbiddenException(
          'Cet outil est réservé aux administrateurs système.',
        );
      }
      return;
  }
}
