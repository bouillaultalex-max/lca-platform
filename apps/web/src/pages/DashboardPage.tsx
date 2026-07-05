import { hasFullAccess, USER_ROLE_LABELS } from '@lca-mes/shared';
import { useAuth } from '../auth/useAuth';

export function DashboardPage() {
  const { user, logout } = useAuth();

  if (!user) {
    return null;
  }

  const fullAccess = hasFullAccess(user.role);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">LCA-MES</h1>
          <p className="text-sm text-gray-500">Laboratoire LCA Distribution</p>
        </div>
        <button
          onClick={logout}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 transition hover:bg-gray-100"
        >
          Se déconnecter
        </button>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8">
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-gray-500">Connecté en tant que</p>
          <p className="mt-1 text-lg font-medium text-gray-900">{user.fullName}</p>
          <div className="mt-3 flex items-center gap-2">
            <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-700">
              {USER_ROLE_LABELS[user.role]}
            </span>
            <span
              className={
                fullAccess
                  ? 'rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700'
                  : 'rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700'
              }
            >
              {fullAccess ? 'Accès complet' : 'Lecture seule'}
            </span>
          </div>
        </div>

        <p className="mt-6 text-sm text-gray-500">
          Le catalogue, les recettes, les stocks et la production seront disponibles ici dans les prochains jalons.
        </p>
      </main>
    </div>
  );
}
