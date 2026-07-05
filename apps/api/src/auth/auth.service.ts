import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { UsersService } from './users.service';
import { AuthenticatedUser } from './types/authenticated-user';
import { User } from '../../generated/prisma/client';

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

function toAuthenticatedUser(user: User): AuthenticatedUser {
  return {
    id: user.id,
    siteId: user.siteId,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * Vérifie les identifiants et retourne l'utilisateur (sans le hash) s'ils sont valides.
   * Ne distingue volontairement pas "email inconnu" de "mot de passe invalide" dans le
   * message d'erreur, pour ne pas révéler quels emails existent.
   */
  async validateCredentials(
    email: string,
    password: string,
  ): Promise<AuthenticatedUser> {
    const user = await this.usersService.findByEmail(email);
    if (!user || !user.active) {
      throw new UnauthorizedException('Identifiants invalides.');
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Identifiants invalides.');
    }

    return toAuthenticatedUser(user);
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
}
