import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsersService, toAuthenticatedUser } from './users.service';
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
   * Exécuté par Passport après vérification de la signature/expiration du token,
   * sur **chaque requête** (pas seulement à la connexion). On relit l'utilisateur
   * en base à chaque fois : un token émis avant une désactivation de compte, ou
   * avant une réinitialisation de mot de passe (`mustChangePassword`), ne doit
   * jamais rester utilisable avec des droits obsolètes jusqu'à son expiration.
   */
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.usersService.findActiveById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('Compte introuvable ou désactivé.');
    }

    return toAuthenticatedUser(user);
  }
}
