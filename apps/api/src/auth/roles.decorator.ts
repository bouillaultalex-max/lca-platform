import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../../generated/prisma/client';

export const ROLES_KEY = 'roles';

/**
 * Restreint un handler (ou un controller entier) aux rôles listés.
 * S'utilise avec `RolesGuard`. Sans ce décorateur, un endpoint protégé par
 * `JwtAuthGuard` reste accessible à tout utilisateur authentifié, quel que soit son rôle.
 *
 * @example
 * @Roles(UserRole.RESPONSABLE_LABORATOIRE, UserRole.RESPONSABLE_ADJOINT)
 * @Post()
 * create(@Body() dto: CreateProductDto) { ... }
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
