import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
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

  @Get('lots')
  @ApiQuery({ name: 'lotNumber', required: true })
  @ApiOperation({
    summary:
      "Recherche des lots par leur numéro métier (ex. 455149) plutôt que par identifiant technique — voir TRAC-03A. Renvoie toujours une liste (ADR 0010 § Décision 15) : plusieurs allocations d'un même batch peuvent désormais partager le même numéro. Même généalogie complète par lot que GET /traceability/lots/:id.",
  })
  @ApiResponse({
    status: 200,
    description:
      "Toujours un tableau, y compris vide ([]) si aucun lot ne correspond — jamais 404 pour une simple absence de résultat.",
    isArray: true,
  })
  findLotTraceabilityByNumber(
    @CurrentUser() user: AuthenticatedUser,
    @Query('lotNumber') lotNumber?: string,
  ): Promise<LotTraceability[]> {
    if (!lotNumber) {
      throw new BadRequestException('Le paramètre lotNumber est obligatoire.');
    }
    return this.traceabilityService.findLotTraceabilityByNumber(
      user.siteId,
      lotNumber,
    );
  }

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
