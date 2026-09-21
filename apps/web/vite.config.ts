import type { IncomingMessage } from 'node:http'
// `vitest/config` réexporte `defineConfig` de Vite en y ajoutant le typage de la
// clé `test` ci-dessous — un seul fichier de config pour `vite`/`vite build` et
// `vitest`, sans dépendance supplémentaire (vitest est déjà une dépendance du projet).
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const API_TARGET = 'http://localhost:3000'

/**
 * Certaines routes React (ex: /catalog, /stock, /production) partagent le même
 * premier segment que des préfixes d'API proxysés ci-dessous. Sans ce garde-fou,
 * un rechargement complet du navigateur (F5) sur l'une de ces routes est intercepté
 * par le proxy et renvoyé tel quel au backend NestJS, qui répond 404 (aucune route
 * ne correspond au chemin nu) au lieu de laisser Vite servir `index.html` et le
 * routeur React prendre la main. Un vrai appel API du frontend (fetch/XHR) n'annonce
 * jamais `text/html` en priorité dans `Accept` — seule une navigation de page (F5,
 * saisie d'URL, lien externe) le fait — c'est ce qui permet de distinguer les deux
 * sans connaître à l'avance la liste des routes React (nouvelle route = déjà couverte).
 */
function bypassPageNavigations(req: IncomingMessage): string | undefined {
  if (req.headers.accept?.includes('html')) {
    return '/index.html'
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Autorise l'accès au serveur de dev via un tunnel Cloudflare (tests utilisateurs
    // à distance), sans ouvrir à n'importe quel hôte. N'affecte que `vite` (dev server) :
    // le build de production (`vite build`) est servi statiquement par NestJS et n'est
    // pas concerné par ce réglage.
    allowedHosts: ['.trycloudflare.com'],
    // En développement, le frontend et l'API tournent sur des ports différents.
    // Ce proxy évite toute configuration CORS : le navigateur ne voit qu'une seule origine.
    // `bypass` (voir bypassPageNavigations ci-dessus) laisse Vite servir le SPA pour
    // toute navigation de page, quel que soit le préfixe — les appels API réels
    // continuent d'être proxysés exactement comme avant.
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true, bypass: bypassPageNavigations },
      '/auth': { target: API_TARGET, changeOrigin: true, bypass: bypassPageNavigations },
      '/catalog': { target: API_TARGET, changeOrigin: true, bypass: bypassPageNavigations },
      '/stock': { target: API_TARGET, changeOrigin: true, bypass: bypassPageNavigations },
      '/batching': { target: API_TARGET, changeOrigin: true, bypass: bypassPageNavigations },
      '/production': { target: API_TARGET, changeOrigin: true, bypass: bypassPageNavigations },
      '/import-export': { target: API_TARGET, changeOrigin: true, bypass: bypassPageNavigations },
      '/feedback': { target: API_TARGET, changeOrigin: true, bypass: bypassPageNavigations },
      '/dashboard': { target: API_TARGET, changeOrigin: true, bypass: bypassPageNavigations },
      '/traceability': { target: API_TARGET, changeOrigin: true, bypass: bypassPageNavigations },
      '/assistant': { target: API_TARGET, changeOrigin: true, bypass: bypassPageNavigations },
      '/health': { target: API_TARGET, changeOrigin: true, bypass: bypassPageNavigations },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // Couvre à la fois les tests de logique pure déjà existants (`*.spec.ts`,
    // ex. resetUnitOfMeasureOnTypeChange.spec.ts) et les nouveaux tests de rendu
    // de composants (`*.test.tsx`) — le défaut de vitest 4 ne matchait que `.spec.ts`.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
})
