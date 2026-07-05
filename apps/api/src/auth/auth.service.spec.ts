import { UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { UsersService } from './users.service';
import { User, UserRole } from '../../generated/prisma/client';

describe('AuthService', () => {
  let authService: AuthService;
  let usersService: { findByEmail: jest.Mock };
  let jwtService: { sign: jest.Mock };

  const activeUser: User = {
    id: 'user-1',
    siteId: 'site-1',
    fullName: 'Alex Bouillault',
    email: 'alex@lca-mes.local',
    passwordHash: '',
    role: UserRole.RESPONSABLE_ADJOINT,
    active: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  beforeEach(async () => {
    usersService = { findByEmail: jest.fn() };
    jwtService = { sign: jest.fn().mockReturnValue('signed-jwt-token') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();

    authService = module.get(AuthService);
  });

  describe('validateCredentials', () => {
    it("rejette un email qui n'existe pas", async () => {
      usersService.findByEmail.mockResolvedValue(null);

      await expect(
        authService.validateCredentials('inconnu@lca-mes.local', 'peu-importe'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejette un compte désactivé même avec le bon mot de passe', async () => {
      const passwordHash = await bcrypt.hash('bon-mot-de-passe', 4);
      usersService.findByEmail.mockResolvedValue({
        ...activeUser,
        active: false,
        passwordHash,
      });

      await expect(
        authService.validateCredentials(activeUser.email, 'bon-mot-de-passe'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejette un mot de passe incorrect', async () => {
      const passwordHash = await bcrypt.hash('bon-mot-de-passe', 4);
      usersService.findByEmail.mockResolvedValue({
        ...activeUser,
        passwordHash,
      });

      await expect(
        authService.validateCredentials(
          activeUser.email,
          'mauvais-mot-de-passe',
        ),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('accepte un mot de passe correct et retourne un utilisateur sans passwordHash', async () => {
      const passwordHash = await bcrypt.hash('bon-mot-de-passe', 4);
      usersService.findByEmail.mockResolvedValue({
        ...activeUser,
        passwordHash,
      });

      const result = await authService.validateCredentials(
        activeUser.email,
        'bon-mot-de-passe',
      );

      expect(result).toEqual({
        id: activeUser.id,
        siteId: activeUser.siteId,
        fullName: activeUser.fullName,
        email: activeUser.email,
        role: activeUser.role,
      });
      expect(
        (result as unknown as { passwordHash?: string }).passwordHash,
      ).toBeUndefined();
    });
  });

  describe('login', () => {
    it('signe un JWT contenant sub/email/role/siteId et le retourne avec le profil', () => {
      const user = {
        id: activeUser.id,
        siteId: activeUser.siteId,
        fullName: activeUser.fullName,
        email: activeUser.email,
        role: activeUser.role,
      };

      const result = authService.login(user);

      expect(jwtService.sign).toHaveBeenCalledWith({
        sub: user.id,
        email: user.email,
        role: user.role,
        siteId: user.siteId,
      });
      expect(result).toEqual({ accessToken: 'signed-jwt-token', user });
    });
  });
});
