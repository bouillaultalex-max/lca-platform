import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  USER_ROLE_LABELS,
  type UserRole,
  type UserAdminView,
  type JobTitle,
} from '@lca-mes/shared';
import { api, ApiError } from '../../api/client';
import { useAuth } from '../../auth/useAuth';
import { AppLayout } from '../../components/AppLayout';
import { PageHeader } from '../../components/ui/PageHeader';
import { SectionCard } from '../../components/ui/SectionCard';

const ROLES: UserRole[] = ['RESPONSABLE_LABORATOIRE', 'RESPONSABLE_ADJOINT', 'DIRECTION', 'DAF'];

const emptyUserForm = {
  fullName: '',
  email: '',
  jobTitleId: '',
  role: 'RESPONSABLE_LABORATOIRE' as UserRole,
  isSystemAdmin: false,
};

type EditUserForm = {
  fullName: string;
  email: string;
  jobTitleId: string;
  role: UserRole;
  isSystemAdmin: boolean;
};

function formatDate(value: string | null): string {
  if (!value) return 'Jamais';
  return new Date(value).toLocaleString('fr-FR');
}

const rowClass = (active: boolean) =>
  `transition-colors odd:bg-white even:bg-gray-50/60 hover:bg-surface-muted ${active ? '' : 'opacity-50'}`;

export function AdminUsersPage() {
  const { token, user: currentUser } = useAuth();

  const [users, setUsers] = useState<UserAdminView[]>([]);
  const [jobTitles, setJobTitles] = useState<JobTitle[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [userForm, setUserForm] = useState(emptyUserForm);
  const [userFormError, setUserFormError] = useState<string | null>(null);
  const [isCreatingUser, setIsCreatingUser] = useState(false);

  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditUserForm | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const [jobTitleName, setJobTitleName] = useState('');
  const [jobTitleError, setJobTitleError] = useState<string | null>(null);

  // Le mot de passe temporaire n'est jamais stocké : affiché une seule fois, ici.
  const [temporaryPasswordInfo, setTemporaryPasswordInfo] = useState<{
    email: string;
    password: string;
  } | null>(null);

  const loadAll = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const [usersResult, jobTitlesResult] = await Promise.all([
        api.listUsers(token),
        api.listJobTitles(token),
      ]);
      setUsers(usersResult);
      setJobTitles(jobTitlesResult);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Impossible de charger les utilisateurs.');
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const activeJobTitles = jobTitles.filter((jobTitle) => jobTitle.active);

  async function handleCreateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setUserFormError(null);
    setIsCreatingUser(true);
    try {
      const result = await api.createUser(token, {
        fullName: userForm.fullName,
        email: userForm.email,
        jobTitleId: userForm.jobTitleId,
        role: userForm.role,
        isSystemAdmin: userForm.isSystemAdmin,
      });
      setTemporaryPasswordInfo({ email: result.user.email, password: result.temporaryPassword });
      setUserForm(emptyUserForm);
      await loadAll();
    } catch (err) {
      setUserFormError(err instanceof ApiError ? err.message : 'Impossible de créer le compte.');
    } finally {
      setIsCreatingUser(false);
    }
  }

  function startEdit(user: UserAdminView) {
    setEditingUserId(user.id);
    setEditError(null);
    setEditForm({
      fullName: user.fullName,
      email: user.email,
      jobTitleId: user.jobTitle?.id ?? '',
      role: user.role,
      isSystemAdmin: user.isSystemAdmin,
    });
  }

  async function handleSaveEdit(userId: string) {
    if (!token || !editForm) return;
    setEditError(null);
    try {
      await api.updateUser(token, userId, editForm);
      setEditingUserId(null);
      setEditForm(null);
      await loadAll();
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : 'Impossible de modifier ce compte.');
    }
  }

  async function handleDeactivate(user: UserAdminView) {
    if (!token) return;
    if (!confirm(`Désactiver le compte de ${user.fullName} ? Il ne pourra plus se connecter.`)) return;
    try {
      await api.deactivateUser(token, user.id);
      await loadAll();
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Impossible de désactiver ce compte.');
    }
  }

  async function handleReactivate(user: UserAdminView) {
    if (!token) return;
    try {
      await api.reactivateUser(token, user.id);
      await loadAll();
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Impossible de réactiver ce compte.');
    }
  }

  async function handleResetPassword(user: UserAdminView) {
    if (!token) return;
    if (!confirm(`Réinitialiser le mot de passe de ${user.fullName} ? Un nouveau mot de passe temporaire sera généré.`)) {
      return;
    }
    try {
      const result = await api.resetUserPassword(token, user.id);
      setTemporaryPasswordInfo({ email: user.email, password: result.temporaryPassword });
      await loadAll();
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Impossible de réinitialiser le mot de passe.');
    }
  }

  async function handleCreateJobTitle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setJobTitleError(null);
    try {
      await api.createJobTitle(token, { name: jobTitleName });
      setJobTitleName('');
      await loadAll();
    } catch (err) {
      setJobTitleError(err instanceof ApiError ? err.message : 'Impossible de créer cette fonction métier.');
    }
  }

  async function handleDeactivateJobTitle(jobTitle: JobTitle) {
    if (!token) return;
    if (!confirm(`Désactiver la fonction "${jobTitle.name}" ? Elle ne sera plus proposée à la création d'un compte.`)) {
      return;
    }
    try {
      await api.deactivateJobTitle(token, jobTitle.id);
      await loadAll();
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Impossible de désactiver cette fonction.');
    }
  }

  async function handleReactivateJobTitle(jobTitle: JobTitle) {
    if (!token) return;
    try {
      await api.reactivateJobTitle(token, jobTitle.id);
      await loadAll();
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Impossible de réactiver cette fonction.');
    }
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <PageHeader
          title="Administration des utilisateurs"
          description="Création et gestion des comptes nominatifs. La désactivation empêche immédiatement toute connexion, sans supprimer l'historique du compte."
        />

        {temporaryPasswordInfo && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
            <p className="text-sm font-semibold text-amber-900">
              Mot de passe temporaire pour {temporaryPasswordInfo.email}
            </p>
            <p className="mt-1 font-mono text-lg text-amber-900">{temporaryPasswordInfo.password}</p>
            <p className="mt-2 text-xs text-amber-800">
              Notez-le maintenant et transmettez-le à la personne concernée : il ne sera plus jamais affiché. Le
              changement de mot de passe sera exigé à la première connexion.
            </p>
            <button
              onClick={() => setTemporaryPasswordInfo(null)}
              className="mt-3 rounded-md border border-amber-300 px-3 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
            >
              J'ai noté le mot de passe
            </button>
          </div>
        )}

        <SectionCard title="Créer un compte utilisateur">
          <form onSubmit={handleCreateUser} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <label htmlFor="admin-user-fullname" className="mb-1.5 block text-xs font-medium text-gray-500">
                Nom complet
              </label>
              <input
                id="admin-user-fullname"
                required
                value={userForm.fullName}
                onChange={(e) => setUserForm({ ...userForm, fullName: e.target.value })}
                className="w-full rounded-md border border-divider px-3 py-2.5 text-sm transition-colors focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
              />
            </div>
            <div>
              <label htmlFor="admin-user-email" className="mb-1.5 block text-xs font-medium text-gray-500">
                Adresse e-mail
              </label>
              <input
                id="admin-user-email"
                required
                type="email"
                value={userForm.email}
                onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
                className="w-full rounded-md border border-divider px-3 py-2.5 text-sm transition-colors focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
              />
            </div>
            <div>
              <label htmlFor="admin-user-jobtitle" className="mb-1.5 block text-xs font-medium text-gray-500">
                Fonction métier
              </label>
              <select
                id="admin-user-jobtitle"
                required
                value={userForm.jobTitleId}
                onChange={(e) => setUserForm({ ...userForm, jobTitleId: e.target.value })}
                className="w-full rounded-md border border-divider px-3 py-2.5 text-sm transition-colors focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
              >
                <option value="">Sélectionner…</option>
                {activeJobTitles.map((jobTitle) => (
                  <option key={jobTitle.id} value={jobTitle.id}>
                    {jobTitle.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="admin-user-role" className="mb-1.5 block text-xs font-medium text-gray-500">
                Rôle logiciel
              </label>
              <select
                id="admin-user-role"
                value={userForm.role}
                onChange={(e) => setUserForm({ ...userForm, role: e.target.value as UserRole })}
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
                  checked={userForm.isSystemAdmin}
                  onChange={(e) => setUserForm({ ...userForm, isSystemAdmin: e.target.checked })}
                  className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
                />
                Administrateur système
              </label>
            </div>

            <div className="sm:col-span-2 lg:col-span-5">
              {userFormError && (
                <p role="alert" className="mb-2 text-sm text-red-600">
                  {userFormError}
                </p>
              )}
              <button
                type="submit"
                disabled={isCreatingUser}
                className="rounded-md bg-navy px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-navy-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isCreatingUser ? 'Création…' : 'Créer le compte'}
              </button>
            </div>
          </form>
        </SectionCard>

        <SectionCard title="Utilisateurs">
          {loadError && (
            <p role="alert" className="mb-4 text-sm text-red-600">
              {loadError}
            </p>
          )}
          {isLoading ? (
            <p className="text-sm text-gray-500">Chargement…</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-divider">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Nom</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">E-mail</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Fonction métier</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Rôle</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Admin</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Dernière connexion</th>
                <th className="px-4 py-2 text-left font-medium text-gray-500">Statut</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-gray-500">
                    Aucun utilisateur.
                  </td>
                </tr>
              )}
              {users.map((user) => {
                const isEditing = editingUserId === user.id;
                return (
                  <tr key={user.id} className={rowClass(user.active)}>
                    {isEditing && editForm ? (
                      <>
                        <td className="px-4 py-2">
                          <label htmlFor={`admin-user-edit-fullname-${user.id}`} className="sr-only">
                            Nom complet
                          </label>
                          <input
                            id={`admin-user-edit-fullname-${user.id}`}
                            aria-label="Nom complet"
                            value={editForm.fullName}
                            onChange={(e) => setEditForm({ ...editForm, fullName: e.target.value })}
                            className="w-full rounded-md border border-divider px-2 py-1 text-sm transition-colors focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <label htmlFor={`admin-user-edit-email-${user.id}`} className="sr-only">
                            Adresse e-mail
                          </label>
                          <input
                            id={`admin-user-edit-email-${user.id}`}
                            aria-label="Adresse e-mail"
                            type="email"
                            value={editForm.email}
                            onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                            className="w-full rounded-md border border-divider px-2 py-1 text-sm transition-colors focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <label htmlFor={`admin-user-edit-jobtitle-${user.id}`} className="sr-only">
                            Fonction métier
                          </label>
                          <select
                            id={`admin-user-edit-jobtitle-${user.id}`}
                            aria-label="Fonction métier"
                            value={editForm.jobTitleId}
                            onChange={(e) => setEditForm({ ...editForm, jobTitleId: e.target.value })}
                            className="w-full rounded-md border border-divider px-2 py-1 text-sm transition-colors focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
                          >
                            <option value="">—</option>
                            {activeJobTitles.map((jobTitle) => (
                              <option key={jobTitle.id} value={jobTitle.id}>
                                {jobTitle.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-2">
                          <label htmlFor={`admin-user-edit-role-${user.id}`} className="sr-only">
                            Rôle logiciel
                          </label>
                          <select
                            id={`admin-user-edit-role-${user.id}`}
                            aria-label="Rôle logiciel"
                            value={editForm.role}
                            onChange={(e) => setEditForm({ ...editForm, role: e.target.value as UserRole })}
                            className="w-full rounded-md border border-divider px-2 py-1 text-sm transition-colors focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
                          >
                            {ROLES.map((role) => (
                              <option key={role} value={role}>
                                {USER_ROLE_LABELS[role]}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-2">
                          <label htmlFor={`admin-user-edit-isadmin-${user.id}`} className="sr-only">
                            Administrateur système
                          </label>
                          <input
                            id={`admin-user-edit-isadmin-${user.id}`}
                            type="checkbox"
                            checked={editForm.isSystemAdmin}
                            disabled={user.id === currentUser?.id}
                            title={
                              user.id === currentUser?.id
                                ? 'Vous ne pouvez pas retirer votre propre statut d’administrateur système.'
                                : undefined
                            }
                            onChange={(e) => setEditForm({ ...editForm, isSystemAdmin: e.target.checked })}
                            className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
                          />
                        </td>
                        <td className="px-4 py-2 text-gray-500">{formatDate(user.lastLoginAt)}</td>
                        <td className="px-4 py-2 text-gray-500">
                          {user.active ? 'Actif' : 'Désactivé'}
                        </td>
                        <td className="px-4 py-2 text-right whitespace-nowrap">
                          {editError && (
                            <p role="alert" className="mb-1 text-xs text-red-600">
                              {editError}
                            </p>
                          )}
                          <button
                            onClick={() => void handleSaveEdit(user.id)}
                            className="mr-2 text-xs font-medium text-navy hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
                          >
                            Enregistrer
                          </button>
                          <button
                            onClick={() => {
                              setEditingUserId(null);
                              setEditForm(null);
                            }}
                            className="text-xs text-gray-500 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
                          >
                            Annuler
                          </button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-2">{user.fullName}</td>
                        <td className="px-4 py-2">{user.email}</td>
                        <td className="px-4 py-2">{user.jobTitle?.name ?? '—'}</td>
                        <td className="px-4 py-2">{USER_ROLE_LABELS[user.role]}</td>
                        <td className="px-4 py-2">
                          {user.isSystemAdmin ? (
                            <span className="rounded-full bg-navy/10 px-2.5 py-0.5 text-xs font-medium text-navy">
                              Administrateur
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-4 py-2 text-gray-500">{formatDate(user.lastLoginAt)}</td>
                        <td className="px-4 py-2">
                          <span
                            className={
                              user.active
                                ? 'rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700'
                                : 'rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500'
                            }
                          >
                            {user.active ? 'Actif' : 'Désactivé'}
                          </span>
                          {user.mustChangePassword && user.active && (
                            <span className="ml-2 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                              Changement de mot de passe en attente
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right whitespace-nowrap">
                          <button
                            onClick={() => startEdit(user)}
                            className="mr-3 text-xs text-navy hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
                          >
                            Modifier
                          </button>
                          <button
                            onClick={() => void handleResetPassword(user)}
                            className="mr-3 text-xs text-gray-600 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
                          >
                            Réinitialiser mot de passe
                          </button>
                          {user.active ? (
                            <button
                              onClick={() => void handleDeactivate(user)}
                              disabled={user.id === currentUser?.id}
                              className="text-xs text-red-600 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              Désactiver
                            </button>
                          ) : (
                            <button
                              onClick={() => void handleReactivate(user)}
                              className="text-xs text-green-600 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
                            >
                              Réactiver
                            </button>
                          )}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Fonctions métier">
          <p className="mb-4 text-xs text-gray-500">
            Utilisées pour attribuer une fonction précise à chaque utilisateur (tableau de bord personnalisé,
            statistiques par fonction...), distinctes des rôles logiciels.
          </p>
          <form onSubmit={handleCreateJobTitle} className="flex flex-wrap items-end gap-3">
            <div className="w-full sm:w-auto">
              <label htmlFor="admin-jobtitle-name" className="mb-1.5 block text-xs font-medium text-gray-500">
                Nom de la fonction
              </label>
              <input
                id="admin-jobtitle-name"
                required
                value={jobTitleName}
                onChange={(e) => setJobTitleName(e.target.value)}
                placeholder="Ex : Responsable adjoint"
                className="w-full rounded-md border border-divider px-3 py-2.5 text-sm transition-colors focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy sm:w-64"
              />
            </div>
            <button
              type="submit"
              className="rounded-md bg-navy px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-navy-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
            >
              Ajouter
            </button>
          </form>
          {jobTitleError && (
            <p role="alert" className="mt-2 text-sm text-red-600">
              {jobTitleError}
            </p>
          )}

          <ul className="mt-4 divide-y divide-gray-100">
            {jobTitles.map((jobTitle) => (
              <li key={jobTitle.id} className="flex items-center justify-between py-2 text-sm">
                <span className={jobTitle.active ? 'text-gray-900' : 'text-gray-400 line-through'}>
                  {jobTitle.name}
                </span>
                {jobTitle.active ? (
                  <button
                    onClick={() => void handleDeactivateJobTitle(jobTitle)}
                    className="text-xs text-red-600 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
                  >
                    Désactiver
                  </button>
                ) : (
                  <button
                    onClick={() => void handleReactivateJobTitle(jobTitle)}
                    className="text-xs text-green-600 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
                  >
                    Réactiver
                  </button>
                )}
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>
    </AppLayout>
  );
}
