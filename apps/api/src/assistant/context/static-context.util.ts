import type { Clock } from './clock';

// Garder synchronisé avec le champ "version" de apps/api/package.json — pas de
// lecture dynamique du fichier (aucune dépendance ajoutée, aucun import JSON).
const APP_VERSION = '0.9.0';
const LOCALE = 'fr-FR';
const TIMEZONE = 'Europe/Paris';

/**
 * Contexte statique (AI-05) : uniquement des faits d'environnement (date,
 * heure, langue, fuseau horaire, version applicative) — jamais de donnée
 * métier, jamais d'accès base de données. `clock` (voir clock.ts) est
 * systématiquement injecté, jamais `new Date()` direct ici, pour rester
 * déterministe dans les tests.
 */
export function buildStaticContext(clock: Clock): string {
  const now = clock.now();
  const date = now.toLocaleDateString(LOCALE, { timeZone: TIMEZONE });
  const time = now.toLocaleTimeString(LOCALE, {
    timeZone: TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
  });

  return [
    `Date : ${date}`,
    `Heure : ${time}`,
    `Langue : ${LOCALE}`,
    `Fuseau horaire : ${TIMEZONE}`,
    `Version de l'application : ${APP_VERSION}`,
  ].join('\n');
}
