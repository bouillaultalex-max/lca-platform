import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
import { RecipesService } from './recipes.service';
import { CreateRecipeDto } from './dto/create-recipe.dto';
import { CurrentUser } from '../../auth/current-user.decorator';
import { Roles } from '../../auth/roles.decorator';
import { FULL_ACCESS_ROLES } from '../../auth/roles.constants';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user';
import { Recipe } from '../../../generated/prisma/client';

@ApiTags('catalog/recipes')
@ApiBearerAuth()
@Roles(...FULL_ACCESS_ROLES)
@Controller('catalog/recipes')
export class RecipesController {
  constructor(private readonly recipesService: RecipesService) {}

  @Get()
  @ApiQuery({ name: 'finishedProductId', required: true })
  @ApiOperation({
    summary:
      'Liste toutes les versions de recette (actives et archivées) pour un produit fini.',
  })
  findAllByProduct(
    @CurrentUser() user: AuthenticatedUser,
    @Query('finishedProductId') finishedProductId?: string,
  ) {
    if (!finishedProductId) {
      throw new BadRequestException(
        'Le paramètre finishedProductId est obligatoire.',
      );
    }
    return this.recipesService.findAllByProduct(user.siteId, finishedProductId);
  }

  @Get(':id')
  @ApiOperation({
    summary: "Détail d'une version de recette, avec ses lignes.",
  })
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.recipesService.findOne(user.siteId, id);
  }

  @Post()
  @ApiOperation({
    summary:
      'Crée une nouvelle recette. Si une version active existe déjà pour ce produit fini et ce format, elle est archivée et remplacée par cette nouvelle version.',
  })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateRecipeDto) {
    return this.recipesService.create(user.siteId, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Archive une recette sans créer de version de remplacement.',
  })
  archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<Recipe> {
    return this.recipesService.archive(user.siteId, id);
  }
}
