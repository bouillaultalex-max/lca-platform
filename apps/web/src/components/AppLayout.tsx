import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { hasFullAccess } from '@lca-mes/shared';
import { useAuth } from '../auth/useAuth';
import { FeedbackButton } from './FeedbackButton';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `border-b-2 px-1 pb-3 text-sm font-medium transition-colors ${
    isActive ? 'border-accent text-white' : 'border-transparent text-white/70 hover:text-white'
  }`;

export function AppLayout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();

  if (!user) {
    return null;
  }

  const fullAccess = hasFullAccess(user.role);

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
          <NavLink to="/dashboard" className={navLinkClass}>
            Tableau de bord
          </NavLink>
          {fullAccess && (
            <>
              <NavLink to="/catalog" className={navLinkClass}>
                Catalogue
              </NavLink>
              <NavLink to="/catalog/recipes" className={navLinkClass}>
                Recettes
              </NavLink>
              <NavLink to="/catalog/machines" className={navLinkClass}>
                Machines
              </NavLink>
              <NavLink to="/catalog/suppliers" className={navLinkClass}>
                Fournisseurs
              </NavLink>
              <NavLink to="/production" className={navLinkClass}>
                Production
              </NavLink>
              <NavLink to="/imports" className={navLinkClass}>
                Imports
              </NavLink>
            </>
          )}
          <NavLink to="/stock" className={navLinkClass}>
            Stock
          </NavLink>
          {user.isSystemAdmin && (
            <>
              <NavLink to="/admin/users" className={navLinkClass}>
                Administration
              </NavLink>
              <NavLink to="/admin/feedback" className={navLinkClass}>
                Retours
              </NavLink>
            </>
          )}
        </nav>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </div>
  );
}
