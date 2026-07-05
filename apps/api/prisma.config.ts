import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    // tsx (et non ts-node) : ts-node classique ne résout pas correctement les imports
    // relatifs en ".js" du client Prisma généré (voir docs/adr/0002-...). tsx (esbuild) le gère nativement.
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env['DATABASE_URL'],
  },
});
