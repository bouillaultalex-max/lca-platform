/**
 * Rôles utilisateurs de LCA-MES.
 * Doit rester synchronisé avec l'enum `UserRole` de apps/api/prisma/schema.prisma
 * (source de vérité côté base de données) — ce fichier existe pour que le frontend
 * n'ait pas à dépendre du client Prisma généré (interne au backend).
 */
export type UserRole = 'RESPONSABLE_LABORATOIRE' | 'RESPONSABLE_ADJOINT' | 'DIRECTION' | 'DAF';

export const FULL_ACCESS_ROLES: UserRole[] = ['RESPONSABLE_LABORATOIRE', 'RESPONSABLE_ADJOINT'];

export const READ_ONLY_ROLES: UserRole[] = ['DIRECTION', 'DAF'];

export function hasFullAccess(role: UserRole): boolean {
  return FULL_ACCESS_ROLES.includes(role);
}

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  RESPONSABLE_LABORATOIRE: 'Responsable laboratoire',
  RESPONSABLE_ADJOINT: 'Responsable adjoint',
  DIRECTION: 'Direction',
  DAF: 'DAF',
};
