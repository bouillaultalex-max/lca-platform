import type { UserRole } from './user-role';

export interface JobTitleSummary {
  id: string;
  name: string;
}

export interface AuthenticatedUser {
  id: string;
  siteId: string;
  fullName: string;
  email: string;
  role: UserRole;
  jobTitle: JobTitleSummary | null;
  isSystemAdmin: boolean;
  mustChangePassword: boolean;
  /** Date ISO de la dernière connexion précédente, ou `null` si jamais connecté avant. */
  lastLoginAt: string | null;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  user: AuthenticatedUser;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}
