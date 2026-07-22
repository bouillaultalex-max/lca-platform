import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { hasFullAccess, USER_ROLE_LABELS, type DashboardSummary } from '@lca-mes/shared';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/useAuth';
import { AppLayout } from '../components/AppLayout';
import { SectionCard } from '../components/ui/SectionCard';
import { formatLastLogin } from '../utils/formatLastLogin';
import { SummaryCard, SummaryDashboard } from './imports/SummaryCard';

interface QuickLink {
  to: string;
  label: string;
}

/** Mêmes routes et mêmes conditions de permission que la Sidebar (voir
 * components/layout/SidebarNav.tsx) — uniquement de la navigation, aucune
 * action métier. */
function buildQuickLinks(fullAccess: boolean): QuickLink[] {
  const links: QuickLink[] = [];
  if (fullAccess) {
    links.push(
      { to: '/production', label: 'Production' },
      { to: '/catalog', label: 'Catalogue' },
    );
  }
  links.push({ to: '/stock', label: 'Stock' }, { to: '/traceability', label: 'Traçabilité' });
  if (fullAccess) {
    links.push({ to: '/imports', label: 'Imports' });
  }
  return links;
}

export function DashboardPage() {
  const { user, token } = useAuth();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [isLoadingSummary, setIsLoadingSummary] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    setIsLoadingSummary(true);
    setSummaryError(null);
    api
      .getDashboardSummary(token)
      .then(setSummary)
      .catch((err: unknown) =>
        setSummaryError(err instanceof ApiError ? err.message : 'Impossible de charger la synthèse.'),
      )
      .finally(() => setIsLoadingSummary(false));
  }, [token]);

  if (!user) {
    return null;
  }

  const fullAccess = hasFullAccess(user.role);
  const firstName = user.fullName.split(' ')[0];
  const quickLinks = buildQuickLinks(fullAccess);

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="rounded-xl border border-divider bg-white p-6 shadow-sm">
          <p className="text-lg font-medium text-gray-900">Bonjour {firstName} 👋</p>
          {user.lastLoginAt && (
            <p className="mt-1 text-sm text-gray-500">
              Dernière connexion : {formatLastLogin(user.lastLoginAt)}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
            {user.jobTitle && <span>{user.jobTitle.name}</span>}
            {user.jobTitle && <span aria-hidden="true">·</span>}
            <span>{USER_ROLE_LABELS[user.role]}</span>
            <span aria-hidden="true">·</span>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-500">
              {fullAccess ? 'Accès complet' : 'Lecture seule'}
            </span>
          </div>
        </div>

        <div>
          <h2 className="mb-3 text-sm font-semibold text-gray-900">Vue d'ensemble</h2>
          {summaryError && <p className="mb-3 text-sm text-red-600">{summaryError}</p>}
          {isLoadingSummary ? (
            <p className="text-sm text-gray-500">Chargement…</p>
          ) : (
            summary && (
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
            )
          )}
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <SectionCard title="Actions rapides">
            <nav aria-label="Actions rapides" className="flex flex-wrap gap-2">
              {quickLinks.map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  className="rounded-md border border-divider px-3 py-2 text-sm font-medium text-navy transition-colors hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </SectionCard>

          <SectionCard title="Activité récente">
            <p className="text-sm text-gray-500">L'activité récente n'est pas encore disponible.</p>
          </SectionCard>
        </div>
      </div>
    </AppLayout>
  );
}
