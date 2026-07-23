import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { IsString } from 'class-validator';
import { ToolExecutorService } from './tool-executor.service';
import { ToolRegistryService } from './tool-registry.service';
import type { ToolDefinition } from './tool.types';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user';
import { UserRole } from '../../../generated/prisma/client';

class SampleInput {
  @IsString()
  query!: string;
}

function buildUser(
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser {
  return {
    id: 'user-1',
    siteId: 'site-1',
    fullName: 'Kevin Prian',
    email: 'kevin.prian@lca-mes.local',
    role: UserRole.RESPONSABLE_ADJOINT,
    jobTitle: null,
    isSystemAdmin: false,
    mustChangePassword: false,
    lastLoginAt: null,
    ...overrides,
  };
}

describe('ToolExecutorService', () => {
  let registry: ToolRegistryService;
  let executor: ToolExecutorService;
  let handler: jest.Mock;

  beforeEach(() => {
    registry = new ToolRegistryService();
    executor = new ToolExecutorService(registry);
    handler = jest.fn().mockResolvedValue({ ok: true });
  });

  it('appelle le handler de l’outil avec l’utilisateur et l’entrée validée', async () => {
    const tool: ToolDefinition<SampleInput, { ok: boolean }> = {
      name: 'sample.tool',
      description: 'Outil de test.',
      inputSchema: SampleInput,
      permission: { kind: 'authenticated' },
      category: 'read',
      handler,
    };
    registry.register(tool);
    const user = buildUser();

    const result = await executor.execute(user, 'sample.tool', {
      query: 'flacon',
    });

    expect(result).toEqual({ ok: true });
    expect(handler).toHaveBeenCalledWith(
      user,
      expect.objectContaining({ query: 'flacon' }),
    );
  });

  it('lève une NotFoundException si l’outil est inconnu', async () => {
    const user = buildUser();

    await expect(executor.execute(user, 'inconnu.tool', {})).rejects.toThrow(
      NotFoundException,
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it('lève une ForbiddenException si l’utilisateur n’a pas la permission requise, sans appeler le handler', async () => {
    const tool: ToolDefinition = {
      name: 'restricted.tool',
      description: 'Outil restreint.',
      inputSchema: undefined,
      permission: { kind: 'roles', roles: [UserRole.RESPONSABLE_LABORATOIRE] },
      category: 'read',
      handler,
    };
    registry.register(tool);
    const user = buildUser({ role: UserRole.DIRECTION });

    await expect(executor.execute(user, 'restricted.tool', {})).rejects.toThrow(
      ForbiddenException,
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejette une entrée invalide sans appeler le handler', async () => {
    const tool: ToolDefinition<SampleInput, unknown> = {
      name: 'sample.tool',
      description: 'Outil de test.',
      inputSchema: SampleInput,
      permission: { kind: 'authenticated' },
      category: 'read',
      handler,
    };
    registry.register(tool);
    const user = buildUser();

    await expect(
      executor.execute(user, 'sample.tool', { query: 42 }),
    ).rejects.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  it('propage l’erreur du handler sans la masquer', async () => {
    const failingHandler = jest.fn().mockRejectedValue(new Error('panne'));
    const tool: ToolDefinition = {
      name: 'failing.tool',
      description: 'Outil qui échoue.',
      inputSchema: undefined,
      permission: { kind: 'authenticated' },
      category: 'read',
      handler: failingHandler,
    };
    registry.register(tool);
    const user = buildUser();

    await expect(executor.execute(user, 'failing.tool', {})).rejects.toThrow(
      'panne',
    );
  });
});
