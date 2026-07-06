import { hasFullAccess, USER_ROLE_LABELS } from '@lca-mes/shared';
import { useAuth } from '../auth/useAuth';
import { AppLayout } from '../components/AppLayout';

export function DashboardPage() {
  const { user } = useAuth();

  if (!user) {
    return null;
  }

  const fullAccess = hasFullAccess(user.role);

  return (
    <AppLayout>
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
        Les stocks et la production seront disponibles ici dans les prochains jalons.
      </p>
    </AppLayout>
  );
}
