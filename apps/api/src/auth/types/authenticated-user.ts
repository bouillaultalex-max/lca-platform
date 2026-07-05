import { UserRole } from '../../../generated/prisma/client';

/**
 * Représentation d'un utilisateur authentifié, sans le hash de mot de passe.
 * C'est la forme attachée à `request.user` par la stratégie JWT, et celle
 * renvoyée par les endpoints exposant des informations utilisateur.
 */
export interface AuthenticatedUser {
  id: string;
  siteId: string;
  fullName: string;
  email: string;
  role: UserRole;
}
