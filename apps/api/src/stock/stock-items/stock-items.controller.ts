import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  StockItemsService,
  type StockItemWithCartons,
} from './stock-items.service';
import { UpdateMinimumThresholdDto } from './dto/update-minimum-threshold.dto';
import { CurrentUser } from '../../auth/current-user.decorator';
import { Roles } from '../../auth/roles.decorator';
import { FULL_ACCESS_ROLES } from '../../auth/roles.constants';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user';
import { ArticleType } from '../../../generated/prisma/client';

/**
 * Consultation (GET) ouverte à tout utilisateur authentifié, y compris
 * DIRECTION/DAF (lecture seule) — voir docs/regles-metier.md §1, contrairement au
 * module catalog qui leur est entièrement fermé. Écriture (PATCH) réservée à
 * `FULL_ACCESS_ROLES`.
 */
@ApiTags('stock/items')
@ApiBearerAuth()
@Controller('stock/items')
export class StockItemsController {
  constructor(private readonly stockItemsService: StockItemsService) {}

  @Get()
  @ApiOperation({
    summary:
      'Liste les stocks disponibles par article, avec équivalent en cartons si configuré.',
  })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('type') type?: ArticleType,
  ): Promise<StockItemWithCartons[]> {
    return this.stockItemsService.findAll(user.siteId, type);
  }

  @Get(':articleId')
  @ApiOperation({ summary: 'Détail du stock disponible pour un article.' })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('articleId') articleId: string,
  ): Promise<StockItemWithCartons> {
    return this.stockItemsService.findOne(user.siteId, articleId);
  }

  @Patch(':articleId')
  @Roles(...FULL_ACCESS_ROLES)
  @ApiOperation({
    summary:
      'Définit le seuil de stock minimum d’un article (déclenche l’indicateur "stock faible").',
  })
  updateMinimumThreshold(
    @CurrentUser() user: AuthenticatedUser,
    @Param('articleId') articleId: string,
    @Body() dto: UpdateMinimumThresholdDto,
  ): Promise<StockItemWithCartons> {
    return this.stockItemsService.setMinimumThreshold(
      user.siteId,
      articleId,
      dto.minimumThreshold,
    );
  }
}
