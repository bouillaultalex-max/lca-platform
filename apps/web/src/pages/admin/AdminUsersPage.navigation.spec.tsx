import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { UserAdminView, AuthenticatedUser } from '@lca-mes/shared';
import { AdminUsersPage } from './AdminUsersPage';

// Ce fichier teste uniquement la navigation ajoutée à l'étape 3 (lien « Voir la
// fiche ») — le reste du comportement de AdminUsersPage (création, édition,
// désactivation...) est déjà en place et hors périmètre de cette étape.

vi.mock('../../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/client')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      listUsers: vi.fn(),
      listJobTitles: vi.fn(),
    },
  };
});

vi.mock('../../auth/useAuth', () => ({
  useAuth: vi.fn(),
}));

import { api } from '../../api/client';
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

const targetUser: UserAdminView = {
  id: 'user-42',
  siteId: 'site-1',
  fullName: 'Kevin Prian',
  email: 'kevin.prian@lca-mes.local',
  role: 'RESPONSABLE_LABORATOIRE',
  jobTitle: { id: 'job-1', name: 'Responsable laboratoire' },
  isSystemAdmin: false,
  mustChangePassword: false,
  lastLoginAt: null,
  active: true,
  createdAt: '2026-01-01T09:00:00.000Z',
  updatedAt: '2026-01-01T09:00:00.000Z',
};

describe('AdminUsersPage — navigation vers la fiche utilisateur', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({
      user: currentAdmin,
      token: 'fake-token',
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });
    vi.mocked(api.listUsers).mockResolvedValue([targetUser]);
    vi.mocked(api.listJobTitles).mockResolvedValue([]);
  });

  it('affiche un lien « Voir la fiche » pointant vers /admin/users/:id', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/users']}>
        <Routes>
          <Route path="/admin/users" element={<AdminUsersPage />} />
          <Route path="/admin/users/:id" element={<div>Fiche de Kevin Prian</div>} />
        </Routes>
      </MemoryRouter>,
    );

    const link = await screen.findByRole('link', { name: 'Voir la fiche' });
    expect(link).toHaveAttribute('href', '/admin/users/user-42');
  });

  it('navigue vers la fiche utilisateur au clic sur « Voir la fiche »', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/users']}>
        <Routes>
          <Route path="/admin/users" element={<AdminUsersPage />} />
          <Route path="/admin/users/:id" element={<div>Fiche de Kevin Prian</div>} />
        </Routes>
      </MemoryRouter>,
    );

    const link = await screen.findByRole('link', { name: 'Voir la fiche' });
    fireEvent.click(link);

    expect(await screen.findByText('Fiche de Kevin Prian')).toBeInTheDocument();
  });
});
