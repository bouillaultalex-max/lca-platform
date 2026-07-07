import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { UsersService, toAuthenticatedUser } from './users.service';
import { LoginHistoryService } from './login-history/login-history.service';
import { AuthenticatedUser } from './types/authenticated-user';
import { User } from '../../generated/prisma/client';

/** Coût bcrypt : identique à `seed.ts` et `bootstrap-admin.ts`, à ne pas diverger. */
const PASSWORD_HASH_COST = 12;

export interface JwtPayload {
  sub: string;
  email: string;
  role: User['role'];
  siteId: string;
}

export interface LoginResult {
  accessToken: string;
  user: AuthenticatedUser;
}

export interface LoginAttemptContext {
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly loginHistoryService: LoginHistoryService,
  ) {}

  /**
   * Vérifie les identifiants, enregistre la tentative dans `LoginHistory` (succès ou
   * échec) et retourne un jeton en cas de succès. Ne distingue volontairement pas
   * "email inconnu" de "mot de passe invalide" dans le message renvoyé au client,
   * pour ne pas révéler quels emails existent.
   */
  async attemptLogin(
    email: string,
    password: string,
    context: LoginAttemptContext = {},
  ): Promise<LoginResult> {
    const user = await this.usersService.findByEmail(email);
    const passwordMatches =
      user && user.active
        ? await bcrypt.compare(password, user.passwordHash)
        : false;

    if (!user || !user.active || !passwordMatches) {
      await this.loginHistoryService.record({
        userId: user?.id ?? null,
        email,
        succeeded: false,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
      throw new UnauthorizedException('Identifiants invalides.');
    }

    await this.loginHistoryService.record({
      userId: user.id,
      email,
      succeeded: true,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
    await this.usersService.touchLastLogin(user.id);

    return this.login(toAuthenticatedUser(user));
  }

  login(user: AuthenticatedUser): LoginResult {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      siteId: user.siteId,
    };

    return {
      accessToken: this.jwtService.sign(payload),
      user,
    };
  }

  /**
   * Changement de mot de passe par l'utilisateur lui-même (workflow normal ou
   * première connexion avec mot de passe temporaire). Lève `mustChangePassword`.
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException('Utilisateur introuvable.');
    }

    const currentMatches = await bcrypt.compare(
      currentPassword,
      user.passwordHash,
    );
    if (!currentMatches) {
      throw new UnauthorizedException('Mot de passe actuel incorrect.');
    }

    const passwordHash = await bcrypt.hash(newPassword, PASSWORD_HASH_COST);
    await this.usersService.setPassword(user.id, passwordHash, false);
  }
}
