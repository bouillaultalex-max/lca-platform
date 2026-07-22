import { FeedbackButton } from '../FeedbackButton';
import { UserMenu } from './UserMenu';

function MenuIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

/**
 * Barre supérieure : commande de bascule de la Sidebar (deux boutons distincts
 * — l'un ouvre le tiroir mobile, l'autre réduit/développe la sidebar fixe
 * desktop/tablette, jamais les deux en même temps grâce aux classes
 * responsive), identité "LCA Platform", et actions utilisateur réellement
 * existantes uniquement (FeedbackButton déjà existant, UserMenu). Aucune
 * notification, aucune recherche — aucune fonctionnalité réelle ne les
 * justifie aujourd'hui.
 */
export function Header({
  isSidebarCollapsed,
  onToggleSidebar,
  onOpenMobileNav,
}: {
  isSidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onOpenMobileNav: () => void;
}) {
  return (
    <header className="sticky top-0 z-20 flex h-[var(--header-height)] items-center justify-between gap-4 bg-navy px-4 text-white sm:px-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onOpenMobileNav}
          aria-label="Ouvrir la navigation"
          className="rounded-md p-2 text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white lg:hidden"
        >
          <MenuIcon />
        </button>
        <button
          type="button"
          onClick={onToggleSidebar}
          aria-label={isSidebarCollapsed ? 'Développer la navigation' : 'Réduire la navigation'}
          aria-expanded={!isSidebarCollapsed}
          className="hidden rounded-md p-2 text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white lg:inline-flex"
        >
          <MenuIcon />
        </button>
        <div className="leading-tight">
          <p className="text-sm font-semibold">LCA Platform</p>
          <p className="text-xs text-white/60">Manufacturing Execution System</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <FeedbackButton />
        <UserMenu />
      </div>
    </header>
  );
}
