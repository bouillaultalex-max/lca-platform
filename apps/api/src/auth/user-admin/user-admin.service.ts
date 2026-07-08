import * as crypto from 'crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { Prisma } from '../../../generated/prisma/client';

const PASSWORD_HASH_COST = 12;

/** Vue exposée par l'API d'administration : ne contient jamais `passwordHash`. */
const adminUserSelect = {
  id: true,
  siteId: true,
  fullName: true,
  email: true,
  role: true,
  isSystemAdmin: true,
  mustChangePassword: true,
  lastLoginAt: true,
  active: true,
  createdAt: true,
  updatedAt: true,
  jobTitle: { select: { id: true, name: true } },
} satisfies Prisma.UserSelect;
export type UserAdminView = Prisma.UserGetPayload<{
  select: typeof adminUserSelect;
}>;

export interface CreatedUserResult {
  user: UserAdminView;
  temporaryPassword: string;
}

/**
 * Génère un mot de passe temporaire lisible (ex: "cheval-42-bureau-livre"), affiché
 * une seule fois dans la réponse à l'administrateur — jamais stocké en clair, jamais
 * journalisé dans `AuditLog`.
 */
function generateTemporaryPassword(): string {
  return crypto.randomBytes(12).toString('base64url');
}

@Injectable()
export class UserAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  findAll(siteId: string): Promise<UserAdminView[]> {
    return this.prisma.user.findMany({
      where: { siteId },
      select: adminUserSelect,
      orderBy: { fullName: 'asc' },
    });
  }

  async findOne(siteId: string, id: string): Promise<UserAdminView> {
    const user = await this.prisma.user.findFirst({
      where: { id, siteId },
      select: adminUserSelect,
    });
    if (!user) {
      throw new NotFoundException(`Utilisateur ${id} introuvable.`);
    }
    return user;
  }

  async create(
    siteId: string,
    dto: CreateUserDto,
    actingUserId: string,
  ): Promise<CreatedUserResult> {
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(
      temporaryPassword,
      PASSWORD_HASH_COST,
    );

    let user: UserAdminView;
    try {
      user = await this.prisma.user.create({
        data: {
          siteId,
          fullName: dto.fullName,
          email: dto.email,
          passwordHash,
          role: dto.role,
          jobTitleId: dto.jobTitleId,
          isSystemAdmin: dto.isSystemAdmin ?? false,
          mustChangePassword: true,
        },
        select: adminUserSelect,
      });
    } catch (error) {
      throw this.toFriendlyError(error, dto.email);
    }

    await this.auditLogService.record({
      userId: actingUserId,
      action: 'CREATE',
      entity: 'User',
      entityId: user.id,
      after: this.toAuditSnapshot(user),
    });

    return { user, temporaryPassword };
  }

  async update(
    siteId: string,
    id: string,
    dto: UpdateUserDto,
    actingUserId: string,
  ): Promise<UserAdminView> {
    if (id === actingUserId && dto.isSystemAdmin === false) {
      throw new ForbiddenException(
        'Vous ne pouvez pas retirer votre propre statut d’administrateur système.',
      );
    }

    const before = await this.findOne(siteId, id);

    let user: UserAdminView;
    try {
      user = await this.prisma.user.update({
        where: { id },
        data: {
          fullName: dto.fullName,
          email: dto.email,
          jobTitleId: dto.jobTitleId,
          role: dto.role,
          isSystemAdmin: dto.isSystemAdmin,
        },
        select: adminUserSelect,
      });
    } catch (error) {
      throw this.toFriendlyError(error, dto.email);
    }

    await this.auditLogService.record({
      userId: actingUserId,
      action: 'UPDATE',
      entity: 'User',
      entityId: user.id,
      before: this.toAuditSnapshot(before),
      after: this.toAuditSnapshot(user),
    });

    return user;
  }

  /** "Suppression" = désactivation, jamais de suppression physique (voir Article/Machine). */
  async deactivate(
    siteId: string,
    id: string,
    actingUserId: string,
  ): Promise<UserAdminView> {
    if (id === actingUserId) {
      throw new ForbiddenException(
        'Vous ne pouvez pas désactiver votre propre compte.',
      );
    }

    const before = await this.findOne(siteId, id);
    const user = await this.prisma.user.update({
      where: { id },
      data: { active: false },
      select: adminUserSelect,
    });

    await this.auditLogService.record({
      userId: actingUserId,
      action: 'DELETE',
      entity: 'User',
      entityId: user.id,
      before: this.toAuditSnapshot(before),
      after: this.toAuditSnapshot(user),
    });

    return user;
  }

  async reactivate(
    siteId: string,
    id: string,
    actingUserId: string,
  ): Promise<UserAdminView> {
    const before = await this.findOne(siteId, id);
    const user = await this.prisma.user.update({
      where: { id },
      data: { active: true },
      select: adminUserSelect,
    });

    await this.auditLogService.record({
      userId: actingUserId,
      action: 'UPDATE',
      entity: 'User',
      entityId: user.id,
      before: this.toAuditSnapshot(before),
      after: this.toAuditSnapshot(user),
    });

    return user;
  }

  /**
   * Réinitialise le mot de passe : génère un nouveau mot de passe temporaire et force
   * `mustChangePassword`. Le mot de passe en clair n'est jamais journalisé.
   */
  async resetPassword(
    siteId: string,
    id: string,
    actingUserId: string,
  ): Promise<{ temporaryPassword: string }> {
    await this.findOne(siteId, id);

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(
      temporaryPassword,
      PASSWORD_HASH_COST,
    );

    await this.prisma.user.update({
      where: { id },
      data: { passwordHash, mustChangePassword: true },
    });

    await this.auditLogService.record({
      userId: actingUserId,
      action: 'UPDATE',
      entity: 'User',
      entityId: id,
      after: { passwordReset: true },
    });

    return { temporaryPassword };
  }

  private toAuditSnapshot(user: UserAdminView): Prisma.InputJsonValue {
    return {
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      jobTitleId: user.jobTitle?.id ?? null,
      isSystemAdmin: user.isSystemAdmin,
      active: user.active,
    };
  }

  private toFriendlyError(error: unknown, email?: string): Error {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return new ConflictException(
        `Un utilisateur avec l'adresse "${email}" existe déjà.`,
      );
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}
