import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsersService } from './users.service';
import { AuthenticatedUser } from './types/authenticated-user';
import { JwtPayload } from './auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
    });
  }

  /**
   * Exécuté par Passport après vérification de la signature/expiration du token.
   * On revérifie que l'utilisateur existe toujours et est actif : un token émis
   * avant une désactivation de compte ne doit pas rester utilisable jusqu'à expiration.
   */
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.usersService.findActiveById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('Compte introuvable ou désactivé.');
    }

    return {
      id: user.id,
      siteId: user.siteId,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
    };
  }
}
