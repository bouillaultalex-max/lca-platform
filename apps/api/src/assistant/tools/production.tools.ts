import type { BatchesService } from '../../batching/batches/batches.service';
import type { BatchStopsService } from '../../production/batch-stops/batch-stops.service';
import { FULL_ACCESS_ROLES } from '../../auth/roles.constants';
import { GetBatchInputDto } from './dto/get-batch-input.dto';
import type { ToolDefinition } from './tool.types';

export interface BatchStopToolResult {
  reason: string;
  startedAt: Date;
  endedAt: Date | null;
  durationMinutes: number | null;
}

export interface BatchToolResult {
  batchId: string;
  recipeId: string;
  machineId: string;
  format: number;
  plannedQuantity: number;
  producedQuantity: number | null;
  rejectedQuantity: number | null;
  status: string;
  currentStep: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  stops: BatchStopToolResult[];
}

export function createProductionTools(
  batchesService: BatchesService,
  batchStopsService: BatchStopsService,
): ToolDefinition[] {
  const getBatch: ToolDefinition<GetBatchInputDto, BatchToolResult> = {
    name: 'production.getBatch',
    description:
      "Renvoie le détail d'un batch de fabrication et ses arrêts, à partir de son identifiant technique (UUID). Ce module ne possède pas de code de batch lisible : ne jamais inventer de numéro, utiliser uniquement l'identifiant réellement fourni.",
    inputSchema: GetBatchInputDto,
    // Module batching/production réservé aux rôles à accès complet — voir
    // batches.controller.ts (@Roles(...FULL_ACCESS_ROLES) sur tout le contrôleur).
    permission: { kind: 'roles', roles: FULL_ACCESS_ROLES },
    category: 'read',
    handler: async (user, input) => {
      const [batch, stops] = await Promise.all([
        batchesService.findOne(user.siteId, input.batchId),
        batchStopsService.findAllByBatch(user.siteId, input.batchId),
      ]);

      return {
        batchId: batch.id,
        recipeId: batch.recipeId,
        machineId: batch.machineId,
        format: batch.format,
        plannedQuantity: batch.plannedQuantity,
        producedQuantity: batch.producedQuantity,
        rejectedQuantity: batch.rejectedQuantity,
        status: batch.status,
        currentStep: batch.currentStep,
        startedAt: batch.startedAt,
        endedAt: batch.endedAt,
        stops: stops.map((stop) => ({
          reason: stop.reason,
          startedAt: stop.startedAt,
          endedAt: stop.endedAt,
          durationMinutes: stop.durationMinutes,
        })),
      };
    },
  };

  return [getBatch];
}
