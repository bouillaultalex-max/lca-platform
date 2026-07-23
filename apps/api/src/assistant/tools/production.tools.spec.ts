import { createProductionTools } from './production.tools';
import { FULL_ACCESS_ROLES } from '../../auth/roles.constants';
import type { BatchesService } from '../../batching/batches/batches.service';
import type { BatchStopsService } from '../../production/batch-stops/batch-stops.service';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user';
import { UserRole } from '../../../generated/prisma/client';

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

describe('production.getBatch', () => {
  it('applique la même permission que le contrôleur batches (FULL_ACCESS_ROLES) et projette le batch avec ses arrêts', async () => {
    const startedAt = new Date('2026-06-01T08:00:00.000Z');
    const findOne = jest.fn().mockResolvedValue({
      id: 'batch-1',
      recipeId: 'recipe-1',
      machineId: 'machine-1',
      format: 100,
      plannedQuantity: 5000,
      producedQuantity: null,
      rejectedQuantity: null,
      status: 'EN_COURS',
      currentStep: 'REMPLISSAGE',
      startedAt,
      endedAt: null,
      // Champ non projeté, ne doit jamais fuiter.
      createdByUserId: 'user-42',
    });
    const batchesService = { findOne } as unknown as BatchesService;
    const findAllByBatch = jest.fn().mockResolvedValue([
      {
        reason: 'Panne machine',
        startedAt,
        endedAt: null,
        durationMinutes: null,
      },
    ]);
    const batchStopsService = {
      findAllByBatch,
    } as unknown as BatchStopsService;

    const [getBatch] = createProductionTools(batchesService, batchStopsService);
    expect(getBatch.name).toBe('production.getBatch');
    expect(getBatch.permission).toEqual({
      kind: 'roles',
      roles: FULL_ACCESS_ROLES,
    });

    const result = await getBatch.handler(buildUser(), {
      batchId: 'batch-1',
    });

    expect(findOne).toHaveBeenCalledWith('site-1', 'batch-1');
    expect(findAllByBatch).toHaveBeenCalledWith('site-1', 'batch-1');
    expect(result).toEqual({
      batchId: 'batch-1',
      recipeId: 'recipe-1',
      machineId: 'machine-1',
      format: 100,
      plannedQuantity: 5000,
      producedQuantity: null,
      rejectedQuantity: null,
      status: 'EN_COURS',
      currentStep: 'REMPLISSAGE',
      startedAt,
      endedAt: null,
      stops: [
        {
          reason: 'Panne machine',
          startedAt,
          endedAt: null,
          durationMinutes: null,
        },
      ],
    });
    expect(result).not.toHaveProperty('createdByUserId');
  });

  it("propage l'erreur si le batch n'existe pas, sans jamais inventer de numéro", async () => {
    const batchesService = {
      findOne: jest
        .fn()
        .mockRejectedValue(new Error('Batch inconnu introuvable.')),
    } as unknown as BatchesService;
    const batchStopsService = {
      findAllByBatch: jest.fn(),
    } as unknown as BatchStopsService;
    const [getBatch] = createProductionTools(batchesService, batchStopsService);

    await expect(
      getBatch.handler(buildUser(), { batchId: 'inconnu' }),
    ).rejects.toThrow('Batch inconnu introuvable.');
  });
});
