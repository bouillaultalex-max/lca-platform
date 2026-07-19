import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UsersService } from './users.service';
import { JwtStrategy } from './jwt.strategy';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { SystemAdminGuard } from './system-admin.guard';
import { MustChangePasswordGuard } from './must-change-password.guard';
import { LoginHistoryService } from './login-history/login-history.service';
import { JobTitlesService } from './job-titles/job-titles.service';
import { JobTitlesController } from './job-titles/job-titles.controller';
import { UserAdminService } from './user-admin/user-admin.service';
import { UserAdminController } from './user-admin/user-admin.controller';
import { AuditLogModule } from '../audit-log/audit-log.module';
import {
  LOGIN_THROTTLE_LIMIT,
  LOGIN_THROTTLE_TTL_MS,
} from './login-throttle.constants';

@Module({
  imports: [
    PassportModule,
    AuditLogModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: configService.getOrThrow<number>('JWT_EXPIRES_IN_SECONDS'),
        },
      }),
    }),
    // Fournit uniquement la configuration/le stockage nécessaires à ThrottlerGuard
    // (voir SEC-02) — n'est jamais enregistré comme garde globale (APP_GUARD) :
    // seul POST /auth/login applique ce garde explicitement (voir AuthController).
    ThrottlerModule.forRoot([
      { ttl: LOGIN_THROTTLE_TTL_MS, limit: LOGIN_THROTTLE_LIMIT },
    ]),
  ],
  controllers: [AuthController, JobTitlesController, UserAdminController],
  providers: [
    AuthService,
    UsersService,
    JwtStrategy,
    LoginHistoryService,
    JobTitlesService,
    UserAdminService,
    // Rendu disponible pour @UseGuards(ThrottlerGuard) sur AuthController.login()
    // uniquement — volontairement pas de { provide: APP_GUARD, ... } ici, sans quoi
    // la limitation s'appliquerait par erreur à toutes les routes de l'API.
    ThrottlerGuard,
    // Guards globaux : Nest applique les guards APP_GUARD dans leur ordre de
    // déclaration. JwtAuthGuard doit s'exécuter en premier (il peuple request.user).
    // MustChangePasswordGuard s'exécute ensuite car il bloque tout le reste tant que
    // le mot de passe temporaire n'a pas été changé. RolesGuard/SystemAdminGuard
    // n'ont de sens qu'une fois ces deux étapes passées.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: MustChangePasswordGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: SystemAdminGuard },
  ],
  exports: [AuthService, UsersService],
})
export class AuthModule {}
