import type { UserRole } from './user-role';

export interface AuthenticatedUser {
  id: string;
  siteId: string;
  fullName: string;
  email: string;
  role: UserRole;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  user: AuthenticatedUser;
}
