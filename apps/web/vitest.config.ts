import { defineConfig } from 'vitest/config';

// Config dédiée, séparée de vite.config.ts (dev server/build) pour ne rien risquer
// sur le serveur de développement existant. Environnement `node` : les fonctions
// testées ici (utils purs) n'ont besoin d'aucun DOM.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
