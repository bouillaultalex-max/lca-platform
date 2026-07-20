import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MarketsService } from './markets.service';
import { CreateMarketDto } from './dto/create-market.dto';
import { UpdateMarketDto } from './dto/update-market.dto';
import { CurrentUser } from '../../auth/current-user.decorator';
import { Roles } from '../../auth/roles.decorator';
import { FULL_ACCESS_ROLES } from '../../auth/roles.constants';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user';
import { Market } from '../../../generated/prisma/client';

@ApiTags('catalog/markets')
@ApiBearerAuth()
@Roles(...FULL_ACCESS_ROLES)
@Controller('catalog/markets')
export class MarketsController {
  constructor(private readonly marketsService: MarketsService) {}

  @Get()
  @ApiOperation({ summary: 'Liste les marchés du site.' })
  findAll(@CurrentUser() user: AuthenticatedUser): Promise<Market[]> {
    return this.marketsService.findAll(user.siteId);
  }

  @Get(':id')
  @ApiOperation({ summary: "Détail d'un marché." })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<Market> {
    return this.marketsService.findOne(user.siteId, id);
  }

  @Post()
  @ApiOperation({ summary: 'Crée un marché.' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateMarketDto,
  ): Promise<Market> {
    return this.marketsService.create(user.siteId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Met à jour un marché existant.' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateMarketDto,
  ): Promise<Market> {
    return this.marketsService.update(user.siteId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary:
      "Désactive un marché (aucune suppression physique, préserve l'historique).",
  })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<Market> {
    return this.marketsService.deactivate(user.siteId, id);
  }
}
