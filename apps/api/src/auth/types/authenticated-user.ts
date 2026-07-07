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
  /** Fonction métier (voir `JobTitle`), `null` si non renseignée. */
  jobTitle: { id: string; name: string } | null;
  /** Capacité d'administration des comptes, indépendante de `role`. */
  isSystemAdmin: boolean;
  /** Si `true`, tout endpoint hors changement de mot de passe est bloqué côté serveur. */
  mustChangePassword: boolean;
  /** Date de la dernière connexion précédente (avant celle en cours), pour l'affichage. */
  lastLoginAt: Date | null;
}
