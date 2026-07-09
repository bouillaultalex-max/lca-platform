import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { hasFullAccess } from '@lca-mes/shared';
import { useAuth } from '../auth/useAuth';
import { FeedbackButton } from './FeedbackButton';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-1.5 text-sm font-medium transition ${
    isActive ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
  }`;

export function AppLayout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();

  if (!user) {
    return null;
  }

  const fullAccess = hasFullAccess(user.role);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">LCA-MES</h1>
            <p className="text-sm text-gray-500">Laboratoire LCA Distribution</p>
          </div>
          <div className="flex items-center gap-3">
            <FeedbackButton />
            <NavLink to="/change-password" className="text-sm text-gray-500 hover:text-gray-700 hover:underline">
              Changer mon mot de passe
            </NavLink>
            <button
              onClick={logout}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 transition hover:bg-gray-100"
            >
              Se déconnecter
            </button>
          </div>
        </div>

        <nav className="mt-4 flex gap-1">
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
