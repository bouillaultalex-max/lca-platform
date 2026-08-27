import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BatchPrintService, type BatchPrintData } from './batch-print.service';
import { CurrentUser } from '../../auth/current-user.decorator';
import { Roles } from '../../auth/roles.decorator';
import { FULL_ACCESS_ROLES } from '../../auth/roles.constants';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user';

/**
 * Module `production` réservé aux rôles à accès complet (voir docs/regles-metier.md
 * §1, même restriction que `BatchStepsController`) : DIRECTION/DAF n'y ont pas accès.
 */
@ApiTags('production/batch-print')
@ApiBearerAuth()
@Roles(...FULL_ACCESS_ROLES)
@Controller('production/batches')
export class BatchPrintController {
  constructor(private readonly batchPrintService: BatchPrintService) {}

  @Get(':id/print-data')
  @ApiOperation({
    summary:
      "Données agrégées pour l'impression des étiquettes Brady BBP12 (une paire PRODUIT + BATCHING par allocation, numéro de lot et DDM réservés au lancement — ADR 0010 § Décisions 16/17). Disponible uniquement pour un batch EN_COURS avec réservation valide ; lecture seule, sans effet de bord, appelable un nombre quelconque de fois.",
  })
  getPrintData(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<BatchPrintData> {
    return this.batchPrintService.getPrintData(user.siteId, id);
  }
}
