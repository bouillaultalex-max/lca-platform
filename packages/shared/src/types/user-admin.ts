import type { UserRole } from './user-role';
import type { JobTitleSummary } from './auth';

export interface JobTitle {
  id: string;
  siteId: string;
  name: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateJobTitleRequest {
  name: string;
}

export interface UpdateJobTitleRequest {
  name?: string;
}

export interface UserAdminView {
  id: string;
  siteId: string;
  fullName: string;
  email: string;
  role: UserRole;
  jobTitle: JobTitleSummary | null;
  isSystemAdmin: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserRequest {
  fullName: string;
  email: string;
  jobTitleId: string;
  role: UserRole;
  isSystemAdmin?: boolean;
}

export interface UpdateUserRequest {
  fullName?: string;
  email?: string;
  jobTitleId?: string;
  role?: UserRole;
  isSystemAdmin?: boolean;
}

export interface CreatedUserResult {
  user: UserAdminView;
  temporaryPassword: string;
}

export interface ResetPasswordResponse {
  temporaryPassword: string;
}
