import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BatchCostsService, type LotBatchCost } from './batch-costs.service';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user';

/**
 * Consultation ouverte à tout utilisateur authentifié, y compris DIRECTION/DAF (voir
 * docs/regles-metier.md §1 et ADR 0007 décision 6) — comme traceability/stock, aucun
 * `@Roles`. Aucune route de recalcul ni de correction : `BatchCost` est immuable en
 * V0.9 (voir ADR 0007).
 */
@ApiTags('costing')
@ApiBearerAuth()
@Controller('costing')
export class BatchCostsController {
  constructor(private readonly batchCostsService: BatchCostsService) {}

  @Get('lots/:lotId/cost')
  @ApiOperation({
    summary:
      "Coût figé d'un lot (matière première + packaging, coût unitaire par flacon) — calculé et immuable depuis la clôture du batch (voir ADR 0007).",
  })
  findByLotId(
    @CurrentUser() user: AuthenticatedUser,
    @Param('lotId') lotId: string,
  ): Promise<LotBatchCost> {
    return this.batchCostsService.findByLotId(user.siteId, lotId);
  }
}
