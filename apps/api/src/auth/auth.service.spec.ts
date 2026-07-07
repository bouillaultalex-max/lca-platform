import { UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { UsersService, UserWithJobTitle } from './users.service';
import { LoginHistoryService } from './login-history/login-history.service';
import { UserRole } from '../../generated/prisma/client';

describe('AuthService', () => {
  let authService: AuthService;
  let usersService: {
    findByEmail: jest.Mock;
    findById: jest.Mock;
    touchLastLogin: jest.Mock;
    setPassword: jest.Mock;
  };
  let loginHistoryService: { record: jest.Mock };
  let jwtService: { sign: jest.Mock };

  const activeUser: UserWithJobTitle = {
    id: 'user-1',
    siteId: 'site-1',
    fullName: 'Alex Bouillault',
    email: 'alex@lca-mes.local',
    passwordHash: '',
    role: UserRole.RESPONSABLE_ADJOINT,
    jobTitleId: 'job-1',
    jobTitle: {
      id: 'job-1',
      siteId: 'site-1',
      name: 'Responsable adjoint',
      active: true,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    },
    isSystemAdmin: true,
    mustChangePassword: false,
    lastLoginAt: null,
    active: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  beforeEach(async () => {
    usersService = {
      findByEmail: jest.fn(),
      findById: jest.fn(),
      touchLastLogin: jest.fn(),
      setPassword: jest.fn(),
    };
    loginHistoryService = { record: jest.fn() };
    jwtService = { sign: jest.fn().mockReturnValue('signed-jwt-token') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: jwtService },
        { provide: LoginHistoryService, useValue: loginHistoryService },
      ],
    }).compile();

    authService = module.get(AuthService);
  });

  describe('attemptLogin', () => {
    it("rejette un email qui n'existe pas et journalise l'échec sans userId", async () => {
      usersService.findByEmail.mockResolvedValue(null);

      await expect(
        authService.attemptLogin('inconnu@lca-mes.local', 'peu-importe'),
      ).rejects.toThrow(UnauthorizedException);

      expect(loginHistoryService.record).toHaveBeenCalledWith(
        expect.objectContaining({ userId: null, succeeded: false }),
      );
    });

    it('rejette un compte désactivé même avec le bon mot de passe', async () => {
      const passwordHash = await bcrypt.hash('bon-mot-de-passe', 4);
      usersService.findByEmail.mockResolvedValue({
        ...activeUser,
        active: false,
        passwordHash,
      });

      await expect(
        authService.attemptLogin(activeUser.email, 'bon-mot-de-passe'),
      ).rejects.toThrow(UnauthorizedException);
      expect(usersService.touchLastLogin).not.toHaveBeenCalled();
    });

    it("rejette un mot de passe incorrect et journalise l'échec avec le userId trouvé", async () => {
      const passwordHash = await bcrypt.hash('bon-mot-de-passe', 4);
      usersService.findByEmail.mockResolvedValue({
        ...activeUser,
        passwordHash,
      });

      await expect(
        authService.attemptLogin(activeUser.email, 'mauvais-mot-de-passe'),
      ).rejects.toThrow(UnauthorizedException);

      expect(loginHistoryService.record).toHaveBeenCalledWith(
        expect.objectContaining({ userId: activeUser.id, succeeded: false }),
      );
    });

    it('accepte un mot de passe correct, journalise le succès et met à jour lastLoginAt', async () => {
      const passwordHash = await bcrypt.hash('bon-mot-de-passe', 4);
      usersService.findByEmail.mockResolvedValue({
        ...activeUser,
        passwordHash,
      });

      const result = await authService.attemptLogin(
        activeUser.email,
        'bon-mot-de-passe',
      );

      expect(result.accessToken).toBe('signed-jwt-token');
      expect(result.user).toEqual({
        id: activeUser.id,
        siteId: activeUser.siteId,
        fullName: activeUser.fullName,
        email: activeUser.email,
        role: activeUser.role,
        jobTitle: { id: 'job-1', name: 'Responsable adjoint' },
        isSystemAdmin: true,
        mustChangePassword: false,
        lastLoginAt: activeUser.lastLoginAt,
      });
      expect(
        (result.user as unknown as { passwordHash?: string }).passwordHash,
      ).toBeUndefined();
      expect(loginHistoryService.record).toHaveBeenCalledWith(
        expect.objectContaining({ userId: activeUser.id, succeeded: true }),
      );
      expect(usersService.touchLastLogin).toHaveBeenCalledWith(activeUser.id);
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
        jobTitle: { id: 'job-1', name: 'Responsable adjoint' },
        isSystemAdmin: true,
        mustChangePassword: false,
        lastLoginAt: null,
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

  describe('changePassword', () => {
    it('rejette si le mot de passe actuel est incorrect', async () => {
      const passwordHash = await bcrypt.hash('bon-mot-de-passe', 4);
      usersService.findById.mockResolvedValue({ ...activeUser, passwordHash });

      await expect(
        authService.changePassword('user-1', 'mauvais', 'nouveau-mot-de-passe'),
      ).rejects.toThrow(UnauthorizedException);
      expect(usersService.setPassword).not.toHaveBeenCalled();
    });

    it('met à jour le mot de passe et lève mustChangePassword si le mot de passe actuel est correct', async () => {
      const passwordHash = await bcrypt.hash('bon-mot-de-passe', 4);
      usersService.findById.mockResolvedValue({ ...activeUser, passwordHash });

      await authService.changePassword(
        'user-1',
        'bon-mot-de-passe',
        'nouveau-mot-de-passe',
      );

      expect(usersService.setPassword).toHaveBeenCalledWith(
        'user-1',
        expect.any(String),
        false,
      );
    });
  });
});
