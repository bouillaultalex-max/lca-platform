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

export interface RoleModuleAccess {
  module: string;
  access: string;
}

/**
 * Résumé lisible des droits par rôle — purement présentationnel, ne pilote
 * aucun contrôle d'accès (le backend reste la seule barrière réelle, voir
 * `apps/api/src/auth/roles.guard.ts`). Dérivé strictement des gardes `@Roles`
 * effectivement posées sur les controllers au moment de la rédaction :
 * - Catalogue, Batching, Production, R&D, Imports OpenSi : `@Roles(...FULL_ACCESS_ROLES)`
 *   au niveau du controller entier (aucun accès, même en lecture, hors de ces rôles).
 * - Stock, Contrôle qualité : lecture ouverte à tous les rôles authentifiés,
 *   écriture (création, modification) réservée à `@Roles(...FULL_ACCESS_ROLES)`.
 * - Traçabilité, Coûts, Tableau de bord : aucune garde de rôle, lecture pour tous.
 * Voir aussi docs/regles-metier.md §1.
 *
 * Entièrement dérivé du rôle : il n'existe aujourd'hui aucune exception de droits
 * par utilisateur (voir audit Étape 4, gestion des droits utilisateurs).
 */
export const FULL_ACCESS_ROLE_PERMISSIONS: RoleModuleAccess[] = [
  { module: 'Catalogue (articles, recettes, machines, fournisseurs…)', access: 'Accès complet' },
  { module: 'Batching', access: 'Accès complet' },
  { module: 'Production', access: 'Accès complet' },
  { module: 'Stock', access: 'Accès complet' },
  { module: 'Contrôle qualité', access: 'Accès complet' },
  { module: 'R&D (aromathèque)', access: 'Accès complet' },
  { module: 'Imports OpenSi', access: 'Accès complet' },
  { module: 'Traçabilité', access: 'Lecture' },
  { module: 'Coûts et tableau de bord', access: 'Lecture' },
];

export const READ_ONLY_ROLE_PERMISSIONS: RoleModuleAccess[] = [
  { module: 'Catalogue (articles, recettes, machines, fournisseurs…)', access: 'Aucun accès' },
  { module: 'Batching', access: 'Aucun accès' },
  { module: 'Production', access: 'Aucun accès' },
  { module: 'Stock', access: 'Lecture seule' },
  { module: 'Contrôle qualité', access: 'Lecture seule' },
  { module: 'R&D (aromathèque)', access: 'Aucun accès' },
  { module: 'Imports OpenSi', access: 'Aucun accès' },
  { module: 'Traçabilité', access: 'Lecture' },
  { module: 'Coûts et tableau de bord', access: 'Lecture' },
];

export function getRolePermissions(role: UserRole): RoleModuleAccess[] {
  return hasFullAccess(role) ? FULL_ACCESS_ROLE_PERMISSIONS : READ_ONLY_ROLE_PERMISSIONS;
}
