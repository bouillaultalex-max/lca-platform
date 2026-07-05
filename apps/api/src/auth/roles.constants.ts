import { UserRole } from '../../generated/prisma/client';

/**
 * Rôles à accès complet (création/modification/suppression) — voir docs/regles-metier.md §1.
 */
export const FULL_ACCESS_ROLES: UserRole[] = [
  UserRole.RESPONSABLE_LABORATOIRE,
  UserRole.RESPONSABLE_ADJOINT,
];

/**
 * Rôles strictement en lecture seule (rapports, statistiques, coûts, stocks, tableaux de bord).
 */
export const READ_ONLY_ROLES: UserRole[] = [UserRole.DIRECTION, UserRole.DAF];

export const ALL_ROLES: UserRole[] = [...FULL_ACCESS_ROLES, ...READ_ONLY_ROLES];
