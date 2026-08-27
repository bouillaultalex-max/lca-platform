import { Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BatchStepsService } from './batch-steps.service';
import { CurrentUser } from '../../auth/current-user.decorator';
import { Roles } from '../../auth/roles.decorator';
import { FULL_ACCESS_ROLES } from '../../auth/roles.constants';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user';
import { Batch } from '../../../generated/prisma/client';

/**
 * Module `production` réservé aux rôles à accès complet (voir docs/regles-metier.md §1) :
 * DIRECTION/DAF n'y ont pas accès, comme `catalog`/`batching`.
 */
@ApiTags('production/batch-steps')
@ApiBearerAuth()
@Roles(...FULL_ACCESS_ROLES)
@Controller('production/batches')
export class BatchStepsController {
  constructor(private readonly batchStepsService: BatchStepsService) {}

  @Post(':id/advance-step')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Fait progresser le batch à l'étape suivante (PREPARATION → MELANGE → INCORPORATION_TREMIE → CONDITIONNEMENT). Aucun retour en arrière.",
  })
  advance(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<Batch> {
    return this.batchStepsService.advance(user.siteId, id, user.id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Annule un batch (PLANIFIE ou EN_COURS → ANNULE). Libère le numéro de lot réservé s'il s'agit du dernier numéro émis pour ce batch ; refusé pour un batch déjà annulé ou terminé.",
  })
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<Batch> {
    return this.batchStepsService.cancel(user.siteId, id, user.id);
  }
}
