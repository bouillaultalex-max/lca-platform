import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { UserAdminView, UserAuditLogEntry, AuthenticatedUser } from '@lca-mes/shared';
import { UserDetailPage } from './UserDetailPage';

vi.mock('../../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/client')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      listUsers: vi.fn(),
      getUserAuditLog: vi.fn(),
      updateUser: vi.fn(),
    },
  };
});

vi.mock('../../auth/useAuth', () => ({
  useAuth: vi.fn(),
}));

import { api, ApiError } from '../../api/client';
import { useAuth } from '../../auth/useAuth';

const currentAdmin: AuthenticatedUser = {
  id: 'admin-1',
  siteId: 'site-1',
  fullName: 'Alexandre Bouillault',
  email: 'admin@lca-mes.local',
  role: 'RESPONSABLE_ADJOINT',
  jobTitle: null,
  isSystemAdmin: true,
  mustChangePassword: false,
  lastLoginAt: null,
};

function mockAuth() {
  vi.mocked(useAuth).mockReturnValue({
    user: currentAdmin,
    token: 'fake-token',
    isLoading: false,
    login: vi.fn(),
    logout: vi.fn(),
    refreshUser: vi.fn(),
  });
}

function buildUser(overrides: Partial<UserAdminView> = {}): UserAdminView {
  return {
    id: 'user-42',
    siteId: 'site-1',
    fullName: 'Kevin Prian',
    email: 'kevin.prian@lca-mes.local',
    role: 'RESPONSABLE_LABORATOIRE',
    jobTitle: { id: 'job-1', name: 'Responsable laboratoire' },
    isSystemAdmin: false,
    mustChangePassword: false,
    lastLoginAt: '2026-01-15T10:00:00.000Z',
    active: true,
    createdAt: '2026-01-01T09:00:00.000Z',
    updatedAt: '2026-01-01T09:00:00.000Z',
    ...overrides,
  };
}

function renderPage(userId = 'user-42') {
  return render(
    <MemoryRouter initialEntries={[`/admin/users/${userId}`]}>
      <Routes>
        <Route path="/admin/users/:id" element={<UserDetailPage />} />
        <Route path="/admin/users" element={<div>Liste des utilisateurs</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('UserDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth();
  });

  it('affiche les informations du compte et le badge de statut', async () => {
    vi.mocked(api.listUsers).mockResolvedValue([buildUser()]);
    vi.mocked(api.getUserAuditLog).mockResolvedValue([]);

    renderPage();

    expect((await screen.findAllByText('Kevin Prian')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('kevin.prian@lca-mes.local').length).toBeGreaterThan(0);
    expect(screen.getByTestId('role-badge')).toHaveTextContent('Responsable laboratoire');
    expect(screen.getByText('Actif')).toBeInTheDocument();
  });

  it("affiche 'Utilisateur introuvable' si l'identifiant ne correspond à aucun compte", async () => {
    vi.mocked(api.listUsers).mockResolvedValue([buildUser({ id: 'un-autre-id' })]);
    vi.mocked(api.getUserAuditLog).mockResolvedValue([]);

    renderPage('user-42');

    expect(await screen.findByText('Utilisateur introuvable.')).toBeInTheDocument();
  });

  it('affiche les droits « accès complet » pour un rôle à accès complet', async () => {
    vi.mocked(api.listUsers).mockResolvedValue([
      buildUser({ role: 'RESPONSABLE_ADJOINT' }),
    ]);
    vi.mocked(api.getUserAuditLog).mockResolvedValue([]);

    renderPage();

    const permissionsTable = await screen.findByTestId('role-permissions-table');
    const catalogRow = within(permissionsTable).getByText(/Catalogue/).closest('tr');
    expect(catalogRow).not.toBeNull();
    expect(within(catalogRow as HTMLElement).getByText('Accès complet')).toBeInTheDocument();
  });

  it('affiche les droits « aucun accès / lecture seule » pour un rôle en lecture seule', async () => {
    vi.mocked(api.listUsers).mockResolvedValue([buildUser({ role: 'DAF' })]);
    vi.mocked(api.getUserAuditLog).mockResolvedValue([]);

    renderPage();

    const permissionsTable = await screen.findByTestId('role-permissions-table');
    const catalogRow = within(permissionsTable).getByText(/Catalogue/).closest('tr');
    expect(within(catalogRow as HTMLElement).getByText('Aucun accès')).toBeInTheDocument();

    const stockRow = within(permissionsTable).getByText('Stock').closest('tr');
    expect(within(stockRow as HTMLElement).getByText('Lecture seule')).toBeInTheDocument();
  });

  it("affiche l'historique avec auteur et changement de rôle avant/après", async () => {
    vi.mocked(api.listUsers).mockResolvedValue([buildUser()]);
    const entries: UserAuditLogEntry[] = [
      {
        id: 'audit-1',
        action: 'UPDATE',
        before: { role: 'DAF' },
        after: { role: 'RESPONSABLE_LABORATOIRE' },
        createdAt: '2026-02-01T08:00:00.000Z',
        user: { id: 'admin-1', fullName: 'Alexandre Bouillault' },
      },
    ];
    vi.mocked(api.getUserAuditLog).mockResolvedValue(entries);

    renderPage();

    const history = await screen.findByTestId('audit-history');
    expect(within(history).getByText('Modification')).toBeInTheDocument();
    expect(within(history).getByText(/par Alexandre Bouillault/)).toBeInTheDocument();
    expect(within(history).getByText(/DAF/)).toBeInTheDocument();
    expect(within(history).getByText(/Responsable laboratoire/)).toBeInTheDocument();
  });

  it("affiche un état vide explicite quand l'historique est vide", async () => {
    vi.mocked(api.listUsers).mockResolvedValue([buildUser()]);
    vi.mocked(api.getUserAuditLog).mockResolvedValue([]);

    renderPage();

    expect(
      await screen.findByText('Aucun événement enregistré pour ce compte.'),
    ).toBeInTheDocument();
  });

  it("affiche une erreur si le chargement de l'historique échoue", async () => {
    vi.mocked(api.listUsers).mockResolvedValue([buildUser()]);
    vi.mocked(api.getUserAuditLog).mockRejectedValue(
      new ApiError(403, "Vous n'avez pas les droits nécessaires pour cette action."),
    );

    renderPage();

    await waitFor(() => {
      expect(
        screen.getByText("Vous n'avez pas les droits nécessaires pour cette action."),
      ).toBeInTheDocument();
    });
  });

  it("le lien « Retour aux utilisateurs » pointe vers la liste", async () => {
    vi.mocked(api.listUsers).mockResolvedValue([buildUser()]);
    vi.mocked(api.getUserAuditLog).mockResolvedValue([]);

    renderPage();

    const backLink = await screen.findByRole('link', { name: /Retour aux utilisateurs/ });
    expect(backLink).toHaveAttribute('href', '/admin/users');
  });

  describe('modification des droits', () => {
    it('affiche le formulaire de modification au clic sur « Modifier les droits »', async () => {
      vi.mocked(api.listUsers).mockResolvedValue([buildUser()]);
      vi.mocked(api.getUserAuditLog).mockResolvedValue([]);

      renderPage();
      await screen.findByTestId('role-permissions-table');

      fireEvent.click(screen.getByRole('button', { name: 'Modifier les droits' }));

      expect(screen.getByTestId('rights-edit-form')).toBeInTheDocument();
      expect(screen.getByLabelText('Rôle logiciel')).toHaveValue('RESPONSABLE_LABORATOIRE');
    });

    it("affiche un résumé des changements et l'aperçu des droits du nouveau rôle avant validation", async () => {
      vi.mocked(api.listUsers).mockResolvedValue([buildUser({ role: 'DAF' })]);
      vi.mocked(api.getUserAuditLog).mockResolvedValue([]);

      renderPage();
      await screen.findByTestId('role-permissions-table');
      fireEvent.click(screen.getByRole('button', { name: 'Modifier les droits' }));

      fireEvent.change(screen.getByLabelText('Rôle logiciel'), {
        target: { value: 'RESPONSABLE_ADJOINT' },
      });

      const summary = screen.getByTestId('rights-change-summary');
      expect(within(summary).getByText(/DAF/)).toBeInTheDocument();
      expect(within(summary).getByText(/Responsable adjoint/)).toBeInTheDocument();
      const preview = screen.getByTestId('pending-role-permissions-table');
      const catalogRow = within(preview).getByText(/Catalogue/).closest('tr');
      expect(within(catalogRow as HTMLElement).getByText('Accès complet')).toBeInTheDocument();
    });

    it('désactive la case « Administrateur système » lors de la modification de son propre compte', async () => {
      vi.mocked(api.listUsers).mockResolvedValue([buildUser({ id: 'admin-1', isSystemAdmin: true })]);
      vi.mocked(api.getUserAuditLog).mockResolvedValue([]);

      renderPage('admin-1');
      await screen.findByTestId('role-permissions-table');
      fireEvent.click(screen.getByRole('button', { name: 'Modifier les droits' }));

      expect(screen.getByLabelText('Administrateur système')).toBeDisabled();
    });

    it('enregistre les modifications, affiche un message de succès et rafraîchit la fiche et l’historique', async () => {
      const initial = buildUser({ role: 'DAF', isSystemAdmin: false });
      const updated = { ...initial, role: 'RESPONSABLE_ADJOINT' as const };
      vi.mocked(api.listUsers).mockResolvedValue([initial]);
      vi.mocked(api.getUserAuditLog).mockResolvedValue([]);
      vi.mocked(api.updateUser).mockResolvedValue(updated);

      renderPage();
      await screen.findByTestId('role-permissions-table');
      fireEvent.click(screen.getByRole('button', { name: 'Modifier les droits' }));
      fireEvent.change(screen.getByLabelText('Rôle logiciel'), {
        target: { value: 'RESPONSABLE_ADJOINT' },
      });

      fireEvent.click(screen.getByRole('button', { name: 'Enregistrer les modifications' }));

      await waitFor(() => {
        expect(api.updateUser).toHaveBeenCalledWith('fake-token', initial.id, {
          role: 'RESPONSABLE_ADJOINT',
          isSystemAdmin: false,
        });
      });

      expect(await screen.findByText('Droits mis à jour avec succès.')).toBeInTheDocument();
      expect(screen.getByTestId('role-badge')).toHaveTextContent('Responsable adjoint');
      expect(screen.queryByTestId('rights-edit-form')).not.toBeInTheDocument();
      // L'historique est rechargé après la modification (voir loadAuditLog dans handleSaveRights).
      await waitFor(() => {
        expect(api.getUserAuditLog).toHaveBeenCalledTimes(2);
      });
    });

    it("affiche un état de chargement pendant l'enregistrement", async () => {
      vi.mocked(api.listUsers).mockResolvedValue([buildUser({ role: 'DAF' })]);
      vi.mocked(api.getUserAuditLog).mockResolvedValue([]);
      let resolveUpdate!: (value: UserAdminView) => void;
      vi.mocked(api.updateUser).mockReturnValue(
        new Promise((resolve) => {
          resolveUpdate = resolve;
        }),
      );

      renderPage();
      await screen.findByTestId('role-permissions-table');
      fireEvent.click(screen.getByRole('button', { name: 'Modifier les droits' }));
      fireEvent.change(screen.getByLabelText('Rôle logiciel'), {
        target: { value: 'RESPONSABLE_ADJOINT' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Enregistrer les modifications' }));

      expect(await screen.findByRole('button', { name: 'Enregistrement…' })).toBeDisabled();

      resolveUpdate(buildUser({ role: 'RESPONSABLE_ADJOINT' }));
      await waitFor(() => {
        expect(screen.queryByTestId('rights-edit-form')).not.toBeInTheDocument();
      });
    });

    it("affiche une erreur si l'enregistrement échoue et conserve le formulaire ouvert", async () => {
      vi.mocked(api.listUsers).mockResolvedValue([buildUser({ role: 'DAF' })]);
      vi.mocked(api.getUserAuditLog).mockResolvedValue([]);
      vi.mocked(api.updateUser).mockRejectedValue(
        new ApiError(403, "Vous n'avez pas les droits nécessaires pour cette action."),
      );

      renderPage();
      await screen.findByTestId('role-permissions-table');
      fireEvent.click(screen.getByRole('button', { name: 'Modifier les droits' }));
      fireEvent.change(screen.getByLabelText('Rôle logiciel'), {
        target: { value: 'RESPONSABLE_ADJOINT' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Enregistrer les modifications' }));

      expect(
        await screen.findByText("Vous n'avez pas les droits nécessaires pour cette action."),
      ).toBeInTheDocument();
      expect(screen.getByTestId('rights-edit-form')).toBeInTheDocument();
    });

    it('annule les modifications en attente au clic sur « Annuler »', async () => {
      vi.mocked(api.listUsers).mockResolvedValue([buildUser({ role: 'DAF' })]);
      vi.mocked(api.getUserAuditLog).mockResolvedValue([]);

      renderPage();
      await screen.findByTestId('role-permissions-table');
      fireEvent.click(screen.getByRole('button', { name: 'Modifier les droits' }));
      fireEvent.change(screen.getByLabelText('Rôle logiciel'), {
        target: { value: 'RESPONSABLE_ADJOINT' },
      });

      fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));

      expect(screen.queryByTestId('rights-edit-form')).not.toBeInTheDocument();
      expect(api.updateUser).not.toHaveBeenCalled();
      expect(screen.getByTestId('role-badge')).toHaveTextContent('DAF');
    });
  });
});
