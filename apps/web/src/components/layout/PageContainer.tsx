import type { ReactNode } from 'react';

/**
 * Centralise la largeur utile, le padding et le comportement responsive de la
 * zone de contenu — remplace le `mx-auto max-w-7xl px-6 py-8` qu'AppLayout
 * posait directement. Volontairement sans contrainte de largeur maximale
 * (utilise toute la largeur disponible à côté de la Sidebar) : les pages
 * n'importent jamais ce composant elles-mêmes, il est appliqué une seule
 * fois par AppShell autour de `children`.
 */
export function PageContainer({ children }: { children: ReactNode }) {
  return <div className="w-full px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>;
}
