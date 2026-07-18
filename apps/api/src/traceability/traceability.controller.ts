import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  TraceabilityService,
  type LotTraceability,
  type StockLotTraceability,
} from './traceability.service';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';

/**
 * Consultation ouverte à tout utilisateur authentifié, y compris DIRECTION/DAF
 * (voir docs/regles-metier.md §1) — comme stock, aucun @Roles.
 */
@ApiTags('traceability')
@ApiBearerAuth()
@Controller('traceability')
export class TraceabilityController {
  constructor(private readonly traceabilityService: TraceabilityService) {}

  @Get('lots/:id')
  @ApiOperation({
    summary:
      "Généalogie complète d'un lot fini : batch, recette, produit fini, statut qualité et toutes les lignes de généalogie (article et StockLot consommés).",
  })
  findLotTraceability(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<LotTraceability> {
    return this.traceabilityService.findLotTraceability(user.siteId, id);
  }

  @Get('stock-lots/:id')
  @ApiOperation({
    summary:
      "Traçabilité inverse d'un StockLot (lot fournisseur) : tous les lots de production qui l'ont consommé, avec pour chacun son batch, sa recette et son produit fini.",
  })
  findStockLotTraceability(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<StockLotTraceability> {
    return this.traceabilityService.findStockLotTraceability(user.siteId, id);
  }
}
