import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  USER_ROLE_LABELS,
  getRolePermissions,
  type UserAdminView,
  type UserAuditLogEntry,
  type UserRole,
} from '@lca-mes/shared';
import { api, ApiError } from '../../api/client';
import { AppLayout } from '../../components/AppLayout';
import { PageHeader } from '../../components/ui/PageHeader';
import { SectionCard } from '../../components/ui/SectionCard';
import { useAuth } from '../../auth/useAuth';

const ROLES: UserRole[] = ['RESPONSABLE_LABORATOIRE', 'RESPONSABLE_ADJOINT', 'DIRECTION', 'DAF'];

function formatDateTime(value: string | null): string {
  if (!value) return 'Jamais';
  return new Date(value).toLocaleString('fr-FR');
}

const AUDIT_ACTION_LABELS: Record<UserAuditLogEntry['action'], string> = {
  CREATE: 'Création du compte',
  UPDATE: 'Modification',
  DELETE: 'Désactivation',
};

const AUDIT_ACTION_BADGE_CLASS: Record<UserAuditLogEntry['action'], string> = {
  CREATE: 'bg-green-50 text-green-700',
  UPDATE: 'bg-navy/10 text-navy',
  DELETE: 'bg-red-50 text-red-700',
};

/** Étiquette lisible des champs bruts avant/après journalisés (voir `toAuditSnapshot` backend). */
const AUDIT_FIELD_LABELS: Record<string, string> = {
  fullName: 'Nom complet',
  email: 'E-mail',
  role: 'Rôle',
  jobTitleId: 'Fonction métier (identifiant)',
  isSystemAdmin: 'Administrateur système',
  active: 'Statut actif',
  passwordReset: 'Mot de passe réinitialisé',
};

function formatAuditValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Oui' : 'Non';
  if (typeof value === 'string' && value in USER_ROLE_LABELS) {
    return USER_ROLE_LABELS[value as keyof typeof USER_ROLE_LABELS];
  }
  return String(value);
}

/**
 * Liste des champs présents dans `before` et/ou `after`, sans reconstruire ni
 * deviner d'information absente des données journalisées par le backend.
 */
function auditChangedFields(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): string[] {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  return Array.from(keys);
}

export function UserDetailPage() {
  const { token, user: currentUser } = useAuth();
  const { id } = useParams<{ id: string }>();

  const [user, setUser] = useState<UserAdminView | null>(null);
  const [isLoadingUser, setIsLoadingUser] = useState(true);
  const [userError, setUserError] = useState<string | null>(null);

  const [auditLog, setAuditLog] = useState<UserAuditLogEntry[] | null>(null);
  const [isLoadingAuditLog, setIsLoadingAuditLog] = useState(true);
  const [auditLogError, setAuditLogError] = useState<string | null>(null);

  const [isEditingRights, setIsEditingRights] = useState(false);
  const [pendingRole, setPendingRole] = useState<UserRole>('RESPONSABLE_LABORATOIRE');
  const [pendingIsSystemAdmin, setPendingIsSystemAdmin] = useState(false);
  const [isSavingRights, setIsSavingRights] = useState(false);
  const [rightsError, setRightsError] = useState<string | null>(null);
  const [rightsSuccessMessage, setRightsSuccessMessage] = useState<string | null>(null);

  // Réutilise GET /auth/users (déjà utilisé par AdminUsersPage) plutôt que
  // d'introduire un nouvel endpoint GET /auth/users/:id non nécessaire à cette
  // fiche : la liste complète contient déjà toutes les informations affichées ici.
  const loadUser = useCallback(async () => {
    if (!token || !id) return;
    setIsLoadingUser(true);
    setUserError(null);
    try {
      const users = await api.listUsers(token);
      const found = users.find((candidate) => candidate.id === id) ?? null;
      setUser(found);
      if (!found) {
        setUserError('Utilisateur introuvable.');
      }
    } catch (err) {
      setUserError(err instanceof ApiError ? err.message : "Impossible de charger ce compte.");
    } finally {
      setIsLoadingUser(false);
    }
  }, [token, id]);

  const loadAuditLog = useCallback(async () => {
    if (!token || !id) return;
    setIsLoadingAuditLog(true);
    setAuditLogError(null);
    try {
      const entries = await api.getUserAuditLog(token, id);
      setAuditLog(entries);
    } catch (err) {
      setAuditLogError(
        err instanceof ApiError ? err.message : "Impossible de charger l'historique.",
      );
    } finally {
      setIsLoadingAuditLog(false);
    }
  }, [token, id]);

  useEffect(() => {
    void loadUser();
    void loadAuditLog();
  }, [loadUser, loadAuditLog]);

  function startEditRights() {
    if (!user) return;
    setPendingRole(user.role);
    setPendingIsSystemAdmin(user.isSystemAdmin);
    setRightsError(null);
    setRightsSuccessMessage(null);
    setIsEditingRights(true);
  }

  function cancelEditRights() {
    setIsEditingRights(false);
    setRightsError(null);
  }

  async function handleSaveRights() {
    if (!token || !user) return;
    setIsSavingRights(true);
    setRightsError(null);
    try {
      const updated = await api.updateUser(token, user.id, {
        role: pendingRole,
        isSystemAdmin: pendingIsSystemAdmin,
      });
      setUser(updated);
      setIsEditingRights(false);
      setRightsSuccessMessage('Droits mis à jour avec succès.');
      await loadAuditLog();
    } catch (err) {
      setRightsError(
        err instanceof ApiError ? err.message : "Impossible d'enregistrer les modifications.",
      );
    } finally {
      setIsSavingRights(false);
    }
  }

  const backLink = (
    <Link
      to="/admin/users"
      className="text-sm font-medium text-navy hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
    >
      ← Retour aux utilisateurs
    </Link>
  );

  if (isLoadingUser) {
    return (
      <AppLayout>
        <div className="space-y-6">
          <PageHeader title="Fiche utilisateur" action={backLink} />
          <p className="text-sm text-gray-500">Chargement…</p>
        </div>
      </AppLayout>
    );
  }

  if (!user) {
    return (
      <AppLayout>
        <div className="space-y-6">
          <PageHeader title="Fiche utilisateur" action={backLink} />
          <SectionCard title="Compte introuvable">
            <p role="alert" className="text-sm text-red-600">
              {userError ?? 'Utilisateur introuvable.'}
            </p>
          </SectionCard>
        </div>
      </AppLayout>
    );
  }

  const permissions = getRolePermissions(user.role);

  return (
    <AppLayout>
      <div className="space-y-6">
        <PageHeader
          title={user.fullName}
          description={user.email}
          action={backLink}
        />

        <SectionCard title="Informations du compte">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className="text-xs font-medium text-gray-500">Nom complet</dt>
              <dd className="mt-1 text-sm text-gray-900">{user.fullName}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-gray-500">E-mail</dt>
              <dd className="mt-1 text-sm text-gray-900">{user.email}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-gray-500">Fonction métier</dt>
              <dd className="mt-1 text-sm text-gray-900">{user.jobTitle?.name ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-gray-500">Statut</dt>
              <dd className="mt-1">
                <span
                  className={
                    user.active
                      ? 'rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700'
                      : 'rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500'
                  }
                >
                  {user.active ? 'Actif' : 'Désactivé'}
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-gray-500">Créé le</dt>
              <dd className="mt-1 text-sm text-gray-900">{formatDateTime(user.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-gray-500">Dernière connexion</dt>
              <dd className="mt-1 text-sm text-gray-900">{formatDateTime(user.lastLoginAt)}</dd>
            </div>
            {user.mustChangePassword && (
              <div>
                <dt className="text-xs font-medium text-gray-500">Mot de passe</dt>
                <dd className="mt-1">
                  <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                    Changement obligatoire en attente
                  </span>
                </dd>
              </div>
            )}
            {user.isSystemAdmin && (
              <div>
                <dt className="text-xs font-medium text-gray-500">Administration</dt>
                <dd className="mt-1">
                  <span className="rounded-full bg-navy/10 px-2.5 py-0.5 text-xs font-medium text-navy">
                    Administrateur système
                  </span>
                </dd>
              </div>
            )}
          </dl>
        </SectionCard>

        <SectionCard title="Rôle et droits">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <span className="text-xs font-medium text-gray-500">Rôle</span>
              <p className="mt-1">
                <span
                  data-testid="role-badge"
                  className="rounded-full bg-navy/10 px-3 py-1 text-sm font-medium text-navy"
                >
                  {USER_ROLE_LABELS[user.role]}
                </span>
              </p>
            </div>
            {!isEditingRights && (
              <button
                type="button"
                onClick={startEditRights}
                className="text-xs font-medium text-navy hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
              >
                Modifier les droits
              </button>
            )}
          </div>

          {isEditingRights ? (
            <div
              data-testid="rights-edit-form"
              className="mb-6 space-y-4 rounded-lg border border-divider bg-gray-50 p-4"
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="user-detail-role"
                    className="mb-1.5 block text-xs font-medium text-gray-500"
                  >
                    Rôle logiciel
                  </label>
                  <select
                    id="user-detail-role"
                    value={pendingRole}
                    onChange={(e) => setPendingRole(e.target.value as UserRole)}
                    disabled={isSavingRights}
                    className="w-full rounded-md border border-divider px-3 py-2.5 text-sm transition-colors focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
                  >
                    {ROLES.map((role) => (
                      <option key={role} value={role}>
                        {USER_ROLE_LABELS[role]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={pendingIsSystemAdmin}
                      disabled={isSavingRights || user.id === currentUser?.id}
                      title={
                        user.id === currentUser?.id
                          ? 'Vous ne pouvez pas modifier votre propre statut d’administrateur système.'
                          : undefined
                      }
                      onChange={(e) => setPendingIsSystemAdmin(e.target.checked)}
                      className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
                    />
                    Administrateur système
                  </label>
                </div>
              </div>

              {(pendingRole !== user.role || pendingIsSystemAdmin !== user.isSystemAdmin) && (
                <div
                  data-testid="rights-change-summary"
                  className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
                >
                  <p className="mb-2 font-medium">Changements à valider avant enregistrement :</p>
                  <ul className="mb-3 list-disc space-y-1 pl-5">
                    {pendingRole !== user.role && (
                      <li>
                        Rôle : {USER_ROLE_LABELS[user.role]} → {USER_ROLE_LABELS[pendingRole]}
                      </li>
                    )}
                    {pendingIsSystemAdmin !== user.isSystemAdmin && (
                      <li>
                        Administrateur système : {user.isSystemAdmin ? 'Oui' : 'Non'} →{' '}
                        {pendingIsSystemAdmin ? 'Oui' : 'Non'}
                      </li>
                    )}
                  </ul>
                  {pendingRole !== user.role && (
                    <div>
                      <p className="mb-1 text-xs font-medium">
                        Droits par module après modification :
                      </p>
                      <div className="overflow-x-auto rounded border border-amber-200 bg-white">
                        <table
                          data-testid="pending-role-permissions-table"
                          className="min-w-full divide-y divide-amber-100 text-xs"
                        >
                          <tbody className="divide-y divide-amber-50">
                            {getRolePermissions(pendingRole).map((permission) => (
                              <tr key={permission.module}>
                                <td className="px-3 py-1.5 text-gray-900">{permission.module}</td>
                                <td className="px-3 py-1.5 text-gray-500">{permission.access}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {rightsError && (
                <p role="alert" className="text-sm text-red-600">
                  {rightsError}
                </p>
              )}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => void handleSaveRights()}
                  disabled={
                    isSavingRights ||
                    (pendingRole === user.role && pendingIsSystemAdmin === user.isSystemAdmin)
                  }
                  className="rounded-md bg-navy px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSavingRights ? 'Enregistrement…' : 'Enregistrer les modifications'}
                </button>
                <button
                  type="button"
                  onClick={cancelEditRights}
                  disabled={isSavingRights}
                  className="text-xs text-gray-500 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Annuler
                </button>
              </div>
            </div>
          ) : (
            rightsSuccessMessage && (
              <p role="status" className="mb-4 text-sm text-green-700">
                {rightsSuccessMessage}
              </p>
            )
          )}

          <p className="mb-3 text-xs text-gray-500">
            Droits associés à ce rôle dans LCA-MES (indépendamment du statut administrateur
            système ci-dessus) — entièrement hérités du rôle, aucune exception individuelle
            n'existe pour ce compte :
          </p>
          <div
            data-testid="role-permissions-table"
            className="overflow-x-auto rounded-lg border border-divider"
          >
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">Module</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-500">Accès</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {permissions.map((permission) => (
                  <tr key={permission.module}>
                    <td className="px-4 py-2 text-gray-900">{permission.module}</td>
                    <td className="px-4 py-2 text-gray-500">{permission.access}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {user.isSystemAdmin && (
            <p className="mt-3 text-xs text-gray-500">
              En tant qu'administrateur système, cet utilisateur peut en plus gérer les comptes
              utilisateurs (création, modification, désactivation), indépendamment de son rôle
              logiciel ci-dessus.
            </p>
          )}
        </SectionCard>

        <SectionCard title="Historique des modifications">
          {isLoadingAuditLog ? (
            <p className="text-sm text-gray-500">Chargement…</p>
          ) : auditLogError ? (
            <p role="alert" className="text-sm text-red-600">
              {auditLogError}
            </p>
          ) : !auditLog || auditLog.length === 0 ? (
            <p className="text-sm text-gray-500">Aucun événement enregistré pour ce compte.</p>
          ) : (
            <ul data-testid="audit-history" className="divide-y divide-gray-100">
              {auditLog.map((entry) => {
                const changedFields = auditChangedFields(entry.before, entry.after);
                return (
                  <li key={entry.id} className="py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${AUDIT_ACTION_BADGE_CLASS[entry.action]}`}
                      >
                        {AUDIT_ACTION_LABELS[entry.action]}
                      </span>
                      <span className="text-xs text-gray-500">
                        {formatDateTime(entry.createdAt)}
                      </span>
                      <span className="text-xs text-gray-500">
                        par {entry.user?.fullName ?? 'Utilisateur inconnu'}
                      </span>
                    </div>
                    {changedFields.length > 0 && (
                      <dl className="mt-2 grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
                        {changedFields.map((field) => (
                          <div key={field} className="flex gap-1">
                            <dt className="font-medium text-gray-500">
                              {AUDIT_FIELD_LABELS[field] ?? field} :
                            </dt>
                            <dd className="text-gray-700">
                              {entry.before && field in entry.before
                                ? formatAuditValue(entry.before[field])
                                : '—'}
                              {' → '}
                              {entry.after && field in entry.after
                                ? formatAuditValue(entry.after[field])
                                : '—'}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>
      </div>
    </AppLayout>
  );
}
