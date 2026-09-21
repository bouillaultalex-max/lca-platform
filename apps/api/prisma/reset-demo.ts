/**
 * Réinitialisation complète de l'environnement DÉMONSTRATION/TEST DAF
 * (`lca_mes_demo`) : supprime la base, la recrée, réapplique les migrations
 * Prisma existantes, puis relance `seed-demo.ts` — retour garanti à un état
 * strictement vierge (hormis les données de référence/démo), quel que soit
 * ce que le DAF y a fait entre-temps.
 *
 * Ne touche JAMAIS `seed.ts`/`bootstrap-admin.ts` ni les mécanismes dev/test —
 * ce script est entièrement indépendant d'eux.
 *
 * Utilisation (voir docs/demo-environment.md) — confirmation explicite requise :
 *   DATABASE_URL="postgresql://lca_mes:<mdp>@localhost:5432/lca_mes_demo?schema=public" \
 *     CONFIRM=yes npx tsx prisma/reset-demo.ts
 *
 * Sans CONFIRM=yes (ou --yes), le script décrit ce qu'il ferait et s'arrête
 * SANS RIEN EXÉCUTER — jamais de DROP DATABASE accidentel.
 */
import { config as loadDotenv } from 'dotenv';
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { Client } from 'pg';
import { assertTargetsDemoDatabase, DEMO_DATABASE_NAME } from './demo-database-guard';

// Charge .env.demo (jamais .env générique) — voir seed-demo.ts pour le détail du
// même principe. Un DATABASE_URL passé explicitement reste toujours prioritaire.
loadDotenv({ path: path.resolve(__dirname, '../.env.demo') });

function hasExplicitConfirmation(): boolean {
  return process.env.CONFIRM === 'yes' || process.argv.includes('--yes');
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  // Lève immédiatement si la cible n'est pas EXACTEMENT "lca_mes_demo" — voir
  // demo-database-guard.ts. Aucune connexion n'est établie avant cette vérification.
  const databaseName = assertTargetsDemoDatabase(databaseUrl);

  console.log(`Cible confirmée : "${databaseName}".`);
  console.log('');
  console.log('Cette opération va :');
  console.log(`  1. Terminer toute connexion active à "${DEMO_DATABASE_NAME}" ;`);
  console.log(`  2. SUPPRIMER intégralement la base "${DEMO_DATABASE_NAME}" (DROP DATABASE) ;`);
  console.log(`  3. La recréer (owner: lca_mes) ;`);
  console.log('  4. Réappliquer les migrations Prisma existantes (prisma migrate deploy) ;');
  console.log('  5. Relancer le seed de démonstration (seed-demo.ts).');
  console.log('');

  if (!hasExplicitConfirmation()) {
    console.log(
      'Aucune action effectuée — confirmation explicite requise. Relancez avec ' +
        'CONFIRM=yes (ou --yes) pour exécuter réellement cette réinitialisation.',
    );
    return;
  }

  // Connexion à la base de maintenance "postgres" (impossible de DROP la base à
  // laquelle on est actuellement connecté) — toujours sur la même instance/le
  // même rôle que DATABASE_URL, seul le nom de base diffère.
  const maintenanceUrl = new URL(databaseUrl!);
  maintenanceUrl.pathname = '/postgres';

  const client = new Client({ connectionString: maintenanceUrl.toString() });
  await client.connect();
  try {
    await client.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [DEMO_DATABASE_NAME],
    );
    // Identifiant de base non paramétrable en SQL préparé — sans risque ici :
    // DEMO_DATABASE_NAME est une constante du code (demo-database-guard.ts),
    // jamais une valeur issue d'une entrée utilisateur/variable d'environnement.
    await client.query(`DROP DATABASE IF EXISTS ${DEMO_DATABASE_NAME}`);
    console.log(`Base "${DEMO_DATABASE_NAME}" supprimée.`);
    await client.query(`CREATE DATABASE ${DEMO_DATABASE_NAME} OWNER lca_mes`);
    console.log(`Base "${DEMO_DATABASE_NAME}" recréée (owner: lca_mes).`);
  } finally {
    await client.end();
  }

  const cwd = path.resolve(__dirname, '..'); // apps/api
  const env = { ...process.env, DATABASE_URL: databaseUrl! };

  console.log('Application des migrations Prisma existantes...');
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd,
    env,
    stdio: 'inherit',
    shell: true,
  });

  console.log('Exécution du seed de démonstration...');
  execFileSync('npx', ['tsx', 'prisma/seed-demo.ts'], {
    cwd,
    env,
    stdio: 'inherit',
    shell: true,
  });

  console.log('');
  console.log(`✅ Environnement "${DEMO_DATABASE_NAME}" réinitialisé avec succès — base strictement vierge.`);
}

main().catch((error: unknown) => {
  console.error('Échec de la réinitialisation demo :', error);
  process.exitCode = 1;
});
