import { config } from 'dotenv';
import { resolve } from 'node:path';

// Charge .env.test avant l'exécution des tests e2e, pour cibler une base
// dédiée (lca_mes_test) distincte de la base de développement.
config({ path: resolve(__dirname, '../.env.test') });
