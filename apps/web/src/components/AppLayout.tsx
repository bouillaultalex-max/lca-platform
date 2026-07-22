import type { ReactNode } from 'react';
import { useAuth } from '../auth/useAuth';
import { AppShell } from './layout/AppShell';

/**
 * Wrapper fin vers AppShell (chantier UI-01) — conserve son nom et sa
 * signature `{ children }` pour que les pages existantes n'aient rien à
 * changer (13 pages l'importent aujourd'hui). Toute la structure (Sidebar,
 * Header, zone de contenu) vit désormais dans `components/layout/`.
 */
export function AppLayout({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  if (!user) {
    return null;
  }

  return <AppShell>{children}</AppShell>;
}
