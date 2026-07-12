import { useEffect, useState } from 'react';
import { hasFullAccess, USER_ROLE_LABELS, type DashboardSummary } from '@lca-mes/shared';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/useAuth';
import { AppLayout } from '../components/AppLayout';
import { formatLastLogin } from '../utils/formatLastLogin';
import { SummaryCard, SummaryDashboard } from './imports/SummaryCard';

export function DashboardPage() {
  const { user, token } = useAuth();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    api
      .getDashboardSummary(token)
      .then(setSummary)
      .catch((err: unknown) =>
        setSummaryError(err instanceof ApiError ? err.message : 'Impossible de charger la synthèse.'),
      );
  }, [token]);

  if (!user) {
    return null;
  }

  const fullAccess = hasFullAccess(user.role);
  const firstName = user.fullName.split(' ')[0];

  return (
    <AppLayout>
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <p className="text-lg font-medium text-gray-900">Bonjour {firstName} 👋</p>
        {user.lastLoginAt && (
          <p className="mt-1 text-sm text-gray-500">
            Dernière connexion : {formatLastLogin(user.lastLoginAt)}
          </p>
        )}
        <div className="mt-3 flex items-center gap-2">
          {user.jobTitle && (
            <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">
              {user.jobTitle.name}
            </span>
          )}
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

      <h2 className="mt-8 mb-3 text-sm font-semibold text-gray-900">Vue d'ensemble</h2>
      {summaryError && <p className="mb-3 text-sm text-red-600">{summaryError}</p>}
      {summary && (
        <SummaryDashboard>
          <SummaryCard icon="📦" value={summary.articlesCount} label="Articles" tone="blue" />
          <SummaryCard icon="🧪" value={summary.activeRecipesCount} label="Recettes actives" tone="blue" />
          <SummaryCard icon="⚙️" value={summary.activeMachinesCount} label="Machines actives" tone="green" />
          <SummaryCard icon="🧊" value={summary.stockLotsCount} label="Lots en stock" tone="blue" />
          <SummaryCard icon="🏭" value={summary.openBatchesCount} label="Productions ouvertes" tone="amber" />
          <SummaryCard icon="💡" value={summary.unresolvedFeedbackCount} label="Retours non traités" tone="amber" />
          <SummaryCard
            icon="📋"
            value={summary.pendingExpectedRequirementsCount}
            label="Besoins importés en attente"
            tone="gray"
          />
        </SummaryDashboard>
      )}
    </AppLayout>
  );
}
