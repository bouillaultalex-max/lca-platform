import {
  BadRequestException,
  Body,
  Controller,
  Get,
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
import { BatchesService } from './batches.service';
import { CreateBatchDto } from './dto/create-batch.dto';
import {
  BatchPreparationService,
  type IngredientQuantity,
} from '../batch-preparation/batch-preparation.service';
import { CurrentUser } from '../../auth/current-user.decorator';
import { Roles } from '../../auth/roles.decorator';
import { FULL_ACCESS_ROLES } from '../../auth/roles.constants';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user';
import { Batch } from '../../../generated/prisma/client';

/**
 * Module `batching` réservé aux rôles à accès complet (voir docs/regles-metier.md §1) :
 * DIRECTION/DAF n'ont pas accès à ce module, ni en lecture ni en écriture — comme catalog,
 * contrairement à stock.
 */
@ApiTags('batching/batches')
@ApiBearerAuth()
@Roles(...FULL_ACCESS_ROLES)
@Controller('batching/batches')
export class BatchesController {
  constructor(
    private readonly batchesService: BatchesService,
    private readonly batchPreparationService: BatchPreparationService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Liste les batches du site.' })
  findAll(@CurrentUser() user: AuthenticatedUser): Promise<Batch[]> {
    return this.batchesService.findAll(user.siteId);
  }

  @Get('preparation')
  @ApiQuery({ name: 'recipeId', required: true })
  @ApiQuery({ name: 'quantity', required: true })
  @ApiOperation({
    summary:
      'Calcule les quantités de matière première (volume + masse) et de packaging nécessaires pour une recette et une quantité à produire — remplace le calcul Excel.',
  })
  computePreparation(
    @CurrentUser() user: AuthenticatedUser,
    @Query('recipeId') recipeId?: string,
    @Query('quantity') quantity?: string,
  ): Promise<IngredientQuantity[]> {
    if (!recipeId || !quantity) {
      throw new BadRequestException(
        'Les paramètres recipeId et quantity sont obligatoires.',
      );
    }
    return this.batchPreparationService.computeIngredientQuantities(
      user.siteId,
      recipeId,
      Number(quantity),
    );
  }

  @Get(':id')
  @ApiOperation({ summary: "Détail d'un batch." })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<Batch> {
    return this.batchesService.findOne(user.siteId, id);
  }

  @Post()
  @ApiOperation({
    summary:
      'Crée un batch (recette active, machine compatible avec le format).',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateBatchDto,
  ): Promise<Batch> {
    return this.batchesService.create(user.siteId, user.id, dto);
  }
}
