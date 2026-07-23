import type { AuthenticatedUser } from '../../auth/types/authenticated-user';
import type { UserRole } from '../../../generated/prisma/client';

/**
 * Exigence de permission d'un outil, calquée sur les mécanismes déjà en place
 * (voir auth/roles.guard.ts et auth/require-system-admin.decorator.ts) — jamais
 * une politique générique unique pour tous les outils, car les endpoints réels
 * ont des permissions hétérogènes par domaine (voir AI-01 §3).
 */
export type ToolPermission =
  /** Ouvert à tout utilisateur authentifié (ex: stock, traceability, dashboard). */
  | { kind: 'authenticated' }
  /** Restreint à une liste de rôles métier (ex: FULL_ACCESS_ROLES). */
  | { kind: 'roles'; roles: UserRole[] }
  /** Restreint aux administrateurs système (ex: gestion des utilisateurs). */
  | { kind: 'systemAdmin' };

/** Classification lecture/écriture d'un outil (voir AI-01 §9). Aucun outil de
 * catégorie B/C n'existe avant AI-06 : ce champ est déjà présent pour ne pas
 * avoir à modifier la forme du registre à ce moment-là. */
export type ToolCategory =
  | 'read' // A — lecture seule, utilisable directement
  | 'prepare' // B — prépare une action, n'écrit jamais
  | 'execute'; // C — exécute une action déjà confirmée

/**
 * Définition d'un outil métier. Le handler ne doit jamais contenir de logique
 * métier propre : il se contente d'appeler un service existant déjà testé,
 * avec l'utilisateur réel transmis par l'orchestrateur (jamais reconstruit).
 */
export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  /** Nom stable, convention "domaine.verbeObjet" (ex: stock.getArticleAvailability). */
  name: string;
  description: string;
  /** Schéma de validation de l'entrée. Type précis volontairement différé à
   * l'ajout du premier outil réel (AI-03) : AI-02 ne définit que l'emplacement. */
  inputSchema: unknown;
  permission: ToolPermission;
  category: ToolCategory;
  handler: (user: AuthenticatedUser, input: TInput) => Promise<TOutput>;
}
