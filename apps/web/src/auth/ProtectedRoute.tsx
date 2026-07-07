import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { hasFullAccess } from '@lca-mes/shared';
import { useAuth } from './useAuth';

export function ProtectedRoute({
  children,
  requireFullAccess = false,
  requireSystemAdmin = false,
  allowPendingPasswordChange = false,
}: {
  children: ReactNode;
  /** Le module catalog est réservé aux rôles à accès complet (voir docs/regles-metier.md §1). */
  requireFullAccess?: boolean;
  /** Réservé aux administrateurs système (indépendant du rôle métier), voir Jalon 2.5. */
  requireSystemAdmin?: boolean;
  /** Exempte du blocage "changement de mot de passe obligatoire" (ex: la page de changement elle-même). */
  allowPendingPasswordChange?: boolean;
}) {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-gray-500">
        Chargement…
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (user.mustChangePassword && !allowPendingPasswordChange) {
    return <Navigate to="/change-password" replace />;
  }

  if (requireFullAccess && !hasFullAccess(user.role)) {
    return <Navigate to="/dashboard" replace />;
  }

  if (requireSystemAdmin && !user.isSystemAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
