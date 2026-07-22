import { useEffect, useState } from 'react';
import { hasFullAccess } from '@lca-mes/shared';
import { useAuth } from '../../auth/useAuth';
import { SidebarNav } from './SidebarNav';

/** Doit rester synchronisé avec le breakpoint Tailwind `lg` (classes `lg:*`
 * utilisées ci-dessous) : c'est le seul point de bascule entre "sidebar fixe
 * toujours visible" (desktop) et "tiroir hors-écran" (en dessous). Aucun token
 * dédié n'existe pour cette valeur (voir contraintes du correctif). */
const DESKTOP_MEDIA_QUERY = '(min-width: 1024px)';

/**
 * Sidebar fixe (desktop, ≥ lg) ou tiroir hors-écran (en dessous de lg, y
 * compris tablette portrait — simplification volontaire du premier incrément,
 * voir la revue d'architecture) — jamais les deux comportements en même
 * temps pour une largeur d'écran donnée. Ne lit que des permissions déjà
 * calculées ailleurs (`hasFullAccess`, `user.isSystemAdmin`) — aucun accès
 * aux données métier.
 */
export function Sidebar({
  isCollapsed,
  isMobileOpen,
  onCloseMobile,
}: {
  isCollapsed: boolean;
  isMobileOpen: boolean;
  onCloseMobile: () => void;
}) {
  const { user } = useAuth();

  // Nécessaire pour décider si le tiroir "fermé" doit être rendu inerte : à
  // ≥ lg, la sidebar est toujours visible et interactive quel que soit
  // `isMobileOpen` (qui ne pilote alors plus rien visuellement) ; en dessous,
  // "fermé" doit au contraire être retiré du clavier et des lecteurs d'écran.
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(DESKTOP_MEDIA_QUERY).matches,
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia(DESKTOP_MEDIA_QUERY);
    const handleChange = (event: MediaQueryListEvent) => setIsDesktop(event.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    if (!isMobileOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onCloseMobile();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isMobileOpen, onCloseMobile]);

  if (!user) {
    return null;
  }

  const fullAccess = hasFullAccess(user.role);
  const widthClass = isCollapsed ? 'lg:w-[var(--sidebar-width-collapsed)]' : 'lg:w-[var(--sidebar-width)]';
  // Inerte uniquement quand le tiroir hors-écran est réellement fermé (en
  // dessous de `lg`) : jamais à desktop, où la sidebar reste toujours visible
  // et interactive indépendamment de `isMobileOpen`.
  const isInert = !isDesktop && !isMobileOpen;

  return (
    <>
      {/* Fond occultant du tiroir mobile : ferme au clic en dehors, purement décoratif
          (Échap et le bouton de fermeture ci-dessous couvrent l'accès clavier). */}
      {isMobileOpen && (
        <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={onCloseMobile} aria-hidden="true" />
      )}

      <aside
        // `inert` (natif, React 19) retire en un seul mécanisme la sidebar du focus,
        // de l'ordre de tabulation et de l'arbre d'accessibilité quand elle est
        // fermée hors desktop — plus robuste qu'un `aria-hidden`/`tabIndex={-1}`
        // manuel sur chaque élément interactif (rien à maintenir si de nouveaux
        // liens sont ajoutés à SidebarNav) et compatible avec la transition CSS
        // existante (contrairement à un démontage conditionnel, qui la supprimerait).
        inert={isInert}
        className={`fixed inset-y-0 left-0 z-40 flex w-[var(--sidebar-width)] flex-col bg-navy text-white transition-transform duration-200 motion-reduce:transition-none ${widthClass} ${
          isMobileOpen ? 'translate-x-0' : '-translate-x-full'
        } lg:translate-x-0`}
      >
        <div className="flex h-[var(--header-height)] items-center justify-between border-b border-white/10 px-4">
          <span className="truncate text-sm font-semibold">{isCollapsed ? 'LP' : 'LCA Platform'}</span>
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Fermer la navigation"
            className="rounded-md p-1 text-white/70 hover:bg-white/10 hover:text-white lg:hidden"
          >
            ✕
          </button>
        </div>
        <SidebarNav
          fullAccess={fullAccess}
          isSystemAdmin={user.isSystemAdmin}
          isCollapsed={isCollapsed}
          onNavigate={onCloseMobile}
        />
      </aside>
    </>
  );
}
