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

/** Reflet de l'enum Prisma `AuditAction` (voir schema.prisma). */
export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE';

export interface UserAuditLogActor {
  id: string;
  fullName: string;
}

/**
 * Entrée d'historique retournée par `GET /auth/users/:id/audit-log` (voir
 * `UserAuditLogEntryView` côté backend, `user-admin.service.ts`). `before`/`after`
 * sont les instantanés bruts déjà journalisés (jamais reconstruits côté frontend).
 */
export interface UserAuditLogEntry {
  id: string;
  action: AuditAction;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
  user: UserAuditLogActor | null;
}
