import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  QualityChecksService,
  type LotWithQualityChecks,
} from './quality-checks.service';
import { CreateQualityCheckDto } from './dto/create-quality-check.dto';
import { CurrentUser } from '../../auth/current-user.decorator';
import { Roles } from '../../auth/roles.decorator';
import { FULL_ACCESS_ROLES } from '../../auth/roles.constants';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user';
import type { QualityCheck } from '../../../generated/prisma/client';

/**
 * QUA-01/QUA-03 (voir ADR 0008). Consultation ouverte à tout utilisateur
 * authentifié, y compris DIRECTION/DAF (voir docs/regles-metier.md §1) — comme
 * traceability/costing, aucun `@Roles` sur la lecture. Écriture réservée à
 * `FULL_ACCESS_ROLES`. Aucune route de modification ni de suppression :
 * `QualityCheck` est immuable en V1 (voir ADR 0008).
 */
@ApiTags('quality')
@ApiBearerAuth()
@Controller('quality')
export class QualityChecksController {
  constructor(private readonly qualityChecksService: QualityChecksService) {}

  @Get('lots/:lotId')
  @ApiOperation({
    summary:
      "Statut qualité global d'un lot et liste de ses contrôles qualité (voir ADR 0008).",
  })
  findByLotId(
    @CurrentUser() user: AuthenticatedUser,
    @Param('lotId') lotId: string,
  ): Promise<LotWithQualityChecks> {
    return this.qualityChecksService.findByLotId(user.siteId, lotId);
  }

  @Post('lots/:lotId/checks')
  @Roles(...FULL_ACCESS_ROLES)
  @ApiOperation({
    summary:
      "Enregistre un contrôle qualité pour un lot et recalcule son statut global dans la même transaction (voir ADR 0008 — QUA-01/QUA-03). Immuable : aucune modification ni suppression possible en V1.",
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('lotId') lotId: string,
    @Body() dto: CreateQualityCheckDto,
  ): Promise<QualityCheck> {
    return this.qualityChecksService.create(user.siteId, user.id, lotId, dto);
  }
}
