/**
 * Garde-fou partagé par `seed-demo.ts` et `reset-demo.ts` : ces deux scripts
 * peuvent écrire des données massivement (le second va jusqu'à DROP/CREATE la
 * base) — une erreur humaine sur `DATABASE_URL` (variable non surchargée,
 * mauvais fichier `.env` chargé) ne doit JAMAIS pouvoir les faire s'exécuter
 * contre `lca_mes_dev` ou `lca_mes_test`. Vérification explicite du nom de
 * base extrait de `DATABASE_URL`, avant toute connexion et toute écriture.
 */

export const DEMO_DATABASE_NAME = 'lca_mes_demo';

const FORBIDDEN_DATABASE_NAMES = ['lca_mes_dev', 'lca_mes_test'];

/**
 * Retourne le nom de base extrait de `databaseUrl` si — et seulement si — il
 * s'agit exactement de `lca_mes_demo`. Lève une erreur explicite et arrête le
 * process immédiatement dans tout autre cas (base absente, URL invalide, ou
 * toute base autre que `lca_mes_demo` — y compris, explicitement, `lca_mes_dev`
 * et `lca_mes_test`).
 */
export function assertTargetsDemoDatabase(
  databaseUrl: string | undefined,
): string {
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL manquant. Ce script doit être lancé avec DATABASE_URL explicitement ' +
        `défini vers la base "${DEMO_DATABASE_NAME}" — jamais une valeur implicite héritée ` +
        'de .env. Voir docs/demo-environment.md.',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error(
      `DATABASE_URL n'est pas une URL PostgreSQL valide : "${databaseUrl}".`,
    );
  }

  const databaseName = parsed.pathname.replace(/^\//, '');

  if (FORBIDDEN_DATABASE_NAMES.includes(databaseName)) {
    throw new Error(
      `REFUS EXPLICITE : ce script ne doit JAMAIS s'exécuter contre "${databaseName}" ` +
        '(base de développement ou de tests automatisés). Abandon immédiat, aucune ' +
        'connexion établie, aucune écriture effectuée.',
    );
  }

  if (databaseName !== DEMO_DATABASE_NAME) {
    throw new Error(
      `REFUS EXPLICITE : ce script ne peut cibler QUE la base "${DEMO_DATABASE_NAME}" — ` +
        `DATABASE_URL pointe vers "${databaseName}". Abandon immédiat, aucune connexion ` +
        'établie, aucune écriture effectuée. Vérifiez la variable DATABASE_URL passée en ' +
        'ligne de commande (voir docs/demo-environment.md).',
    );
  }

  return databaseName;
}
