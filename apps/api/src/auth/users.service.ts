import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, User } from '../../generated/prisma/client';
import { AuthenticatedUser } from './types/authenticated-user';

export type UserWithJobTitle = Prisma.UserGetPayload<{
  include: { jobTitle: true };
}>;

/**
 * Projette une entité `User` (avec sa fonction métier) vers la forme exposée par
 * l'API, sans jamais inclure le hash du mot de passe.
 */
export function toAuthenticatedUser(user: UserWithJobTitle): AuthenticatedUser {
  return {
    id: user.id,
    siteId: user.siteId,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
    jobTitle: user.jobTitle
      ? { id: user.jobTitle.id, name: user.jobTitle.name }
      : null,
    isSystemAdmin: user.isSystemAdmin,
    mustChangePassword: user.mustChangePassword,
    lastLoginAt: user.lastLoginAt,
  };
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<UserWithJobTitle | null> {
    return this.prisma.user.findUnique({
      where: { email },
      include: { jobTitle: true },
    });
  }

  findActiveById(id: string): Promise<UserWithJobTitle | null> {
    return this.prisma.user.findFirst({
      where: { id, active: true },
      include: { jobTitle: true },
    });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  touchLastLogin(id: string): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: { lastLoginAt: new Date() },
    });
  }

  setPassword(
    id: string,
    passwordHash: string,
    mustChangePassword: boolean,
  ): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: { passwordHash, mustChangePassword },
    });
  }
}
