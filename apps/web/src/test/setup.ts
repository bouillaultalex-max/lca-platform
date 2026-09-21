// Étend `expect` avec les matchers DOM (toBeInTheDocument, etc.) pour tous les
// tests de composants — chargé automatiquement par vitest (voir vite.config.ts).
import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// `test.globals` n'est pas activé (imports explicites `from 'vitest'` partout,
// cohérent avec le reste du projet) : le nettoyage automatique du DOM entre
// tests de @testing-library/react doit donc être déclenché explicitement ici,
// sans quoi le rendu d'un test contaminerait le suivant dans le même fichier.
afterEach(() => {
  cleanup();
});

// jsdom n'implémente pas `matchMedia` (pas de moteur CSS réel) — nécessaire dès
// qu'un composant rendu passe par `Sidebar`/`AppShell` (détection desktop/mobile).
// Polyfill standard, minimal, sans rapport avec la logique testée elle-même.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// jsdom n'implémente pas non plus `scrollIntoView` — utilisé par le panneau
// assistant (`ConversationView`), également monté via `AppShell`.
Element.prototype.scrollIntoView = vi.fn();
