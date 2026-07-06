import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ArticlesService } from './articles.service';
import { CreateArticleDto } from './dto/create-article.dto';
import { UpdateArticleDto } from './dto/update-article.dto';
import { CurrentUser } from '../../auth/current-user.decorator';
import { Roles } from '../../auth/roles.decorator';
import { FULL_ACCESS_ROLES } from '../../auth/roles.constants';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user';
import { Article, ArticleType } from '../../../generated/prisma/client';

/**
 * Module catalog réservé aux rôles à accès complet (voir docs/regles-metier.md §1) :
 * DIRECTION/DAF n'ont pas accès au catalogue, pas même en lecture.
 */
@ApiTags('catalog/articles')
@ApiBearerAuth()
@Roles(...FULL_ACCESS_ROLES)
@Controller('catalog/articles')
export class ArticlesController {
  constructor(private readonly articlesService: ArticlesService) {}

  @Get()
  @ApiOperation({
    summary: 'Liste les articles du site, avec filtre optionnel par type.',
  })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('type') type?: ArticleType,
  ): Promise<Article[]> {
    return this.articlesService.findAll(user.siteId, type);
  }

  @Get(':id')
  @ApiOperation({ summary: "Détail d'un article." })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<Article> {
    return this.articlesService.findOne(user.siteId, id);
  }

  @Post()
  @ApiOperation({
    summary: 'Crée un article (matière première, packaging ou produit fini).',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateArticleDto,
  ): Promise<Article> {
    return this.articlesService.create(user.siteId, dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'Met à jour un article existant (le type ne peut pas être modifié).',
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateArticleDto,
  ): Promise<Article> {
    return this.articlesService.update(user.siteId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary:
      "Désactive un article (aucune suppression physique, préserve l'historique).",
  })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<Article> {
    return this.articlesService.deactivate(user.siteId, id);
  }
}
