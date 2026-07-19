import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { hasFullAccess } from '@lca-mes/shared';
import { useAuth } from '../auth/useAuth';
import { FeedbackButton } from './FeedbackButton';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `border-b-2 px-1 pb-3 text-sm font-medium transition-colors ${
    isActive ? 'border-accent text-white' : 'border-transparent text-white/70 hover:text-white'
  }`;

interface NavItem {
  to: string;
  label: string;
}

/**
 * Chaque route de la barre de navigation est une destination exacte (aucune n'est
 * pensée comme "section parente" d'une autre) : `end` est donc systématiquement
 * appliqué au rendu, pour que NavLink exige une correspondance exacte plutôt que par
 * préfixe (sinon "/catalog" resterait actif sur "/catalog/recipes", "/catalog/machines"
 * etc., dont il est un préfixe — bug corrigé le 2026-07-14).
 */
function buildNavItems(fullAccess: boolean, isSystemAdmin: boolean): NavItem[] {
  const items: NavItem[] = [{ to: '/dashboard', label: 'Tableau de bord' }];
  if (fullAccess) {
    items.push(
      { to: '/catalog', label: 'Catalogue' },
      { to: '/catalog/recipes', label: 'Recettes' },
      { to: '/catalog/machines', label: 'Machines' },
      { to: '/catalog/suppliers', label: 'Fournisseurs' },
      { to: '/production', label: 'Production' },
      { to: '/imports', label: 'Imports' },
    );
  }
  items.push({ to: '/stock', label: 'Stock' }, { to: '/traceability', label: 'Traçabilité' });
  if (isSystemAdmin) {
    items.push(
      { to: '/admin/users', label: 'Administration' },
      { to: '/admin/feedback', label: 'Retours' },
    );
  }
  return items;
}

export function AppLayout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();

  if (!user) {
    return null;
  }

  const fullAccess = hasFullAccess(user.role);
  const navItems = buildNavItems(fullAccess, user.isSystemAdmin);

  return (
    <div className="min-h-screen bg-brand-bg">
      <header className="bg-brand-dark px-6 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div>
              <p className="text-sm font-medium text-white">Maison Fuel Platform</p>
              <p className="text-xs text-white/60">Manufacturing Execution System</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <FeedbackButton />
            <NavLink to="/change-password" className="text-sm text-white/70 transition-colors hover:text-white">
              Changer mon mot de passe
            </NavLink>
            <button
              onClick={logout}
              className="rounded-md border border-white/25 px-3 py-1.5 text-sm text-white transition-colors hover:bg-white/10"
            >
              Se déconnecter
            </button>
          </div>
        </div>

        <nav className="mt-4 flex flex-wrap gap-4">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} end className={navLinkClass}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </div>
  );
}
