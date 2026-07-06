import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { StockLotsService } from './stock-lots.service';
import { CreateStockLotDto } from './dto/create-stock-lot.dto';
import { AdjustStockLotDto } from './dto/adjust-stock-lot.dto';
import { CurrentUser } from '../../auth/current-user.decorator';
import { Roles } from '../../auth/roles.decorator';
import { FULL_ACCESS_ROLES } from '../../auth/roles.constants';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user';
import { StockLot } from '../../../generated/prisma/client';

/**
 * Consultation (GET) ouverte à tout utilisateur authentifié y compris DIRECTION/DAF
 * (voir docs/regles-metier.md §1) ; écriture (POST) réservée à `FULL_ACCESS_ROLES`.
 */
@ApiTags('stock/lots')
@ApiBearerAuth()
@Controller('stock/lots')
export class StockLotsController {
  constructor(private readonly stockLotsService: StockLotsService) {}

  @Get()
  @ApiQuery({ name: 'articleId', required: true })
  @ApiOperation({
    summary:
      "Liste les lots de réception d'un article, du plus ancien au plus récent (ordre FIFO).",
  })
  findAllByArticle(
    @CurrentUser() user: AuthenticatedUser,
    @Query('articleId') articleId?: string,
  ): Promise<StockLot[]> {
    if (!articleId) {
      throw new BadRequestException('Le paramètre articleId est obligatoire.');
    }
    return this.stockLotsService.findAllByArticle(user.siteId, articleId);
  }

  @Post()
  @Roles(...FULL_ACCESS_ROLES)
  @ApiOperation({
    summary:
      'Réceptionne un lot physique (fût, seau, carton...) et met à jour le stock disponible.',
  })
  receive(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateStockLotDto,
  ): Promise<StockLot> {
    return this.stockLotsService.receive(user.siteId, user.id, dto);
  }

  @Post(':id/adjustments')
  @HttpCode(HttpStatus.OK)
  @Roles(...FULL_ACCESS_ROLES)
  @ApiOperation({
    summary:
      "Ajustement d'inventaire sur un lot précis (quantité physiquement constatée), toujours journalisé en StockMovement.",
  })
  adjust(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AdjustStockLotDto,
  ): Promise<StockLot> {
    return this.stockLotsService.adjust(user.siteId, user.id, id, dto);
  }
}
