import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { hasFullAccess } from '@lca-mes/shared';
import { useAuth } from './useAuth';

export function ProtectedRoute({
  children,
  requireFullAccess = false,
}: {
  children: ReactNode;
  /** Le module catalog est réservé aux rôles à accès complet (voir docs/regles-metier.md §1). */
  requireFullAccess?: boolean;
}) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-gray-500">
        Chargement…
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (requireFullAccess && !hasFullAccess(user.role)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
