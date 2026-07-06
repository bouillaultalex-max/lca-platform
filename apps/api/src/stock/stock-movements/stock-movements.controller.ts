import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { StockMovementsService } from './stock-movements.service';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user';
import { StockMovement } from '../../../generated/prisma/client';

/**
 * Consultation ouverte à tout utilisateur authentifié y compris DIRECTION/DAF —
 * voir docs/regles-metier.md §1. Aucune écriture ici : les mouvements ne sont créés
 * que par la réception et l'ajustement (module `stock-lots`), jamais directement.
 */
@ApiTags('stock/movements')
@ApiBearerAuth()
@Controller('stock/movements')
export class StockMovementsController {
  constructor(private readonly stockMovementsService: StockMovementsService) {}

  @Get()
  @ApiQuery({ name: 'stockLotId', required: true })
  @ApiOperation({
    summary:
      "Historique des mouvements d'un lot précis, du plus récent au plus ancien.",
  })
  findAllByStockLot(
    @CurrentUser() user: AuthenticatedUser,
    @Query('stockLotId') stockLotId?: string,
  ): Promise<StockMovement[]> {
    if (!stockLotId) {
      throw new BadRequestException('Le paramètre stockLotId est obligatoire.');
    }
    return this.stockMovementsService.findAllByStockLot(
      user.siteId,
      stockLotId,
    );
  }
}
