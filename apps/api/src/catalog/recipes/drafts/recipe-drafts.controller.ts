import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { RecipeDraftsService } from './recipe-drafts.service';
import { SaveRecipeDraftDto } from './dto/save-recipe-draft.dto';
import { CurrentUser } from '../../../auth/current-user.decorator';
import { Roles } from '../../../auth/roles.decorator';
import { FULL_ACCESS_ROLES } from '../../../auth/roles.constants';
import type { AuthenticatedUser } from '../../../auth/types/authenticated-user';

@ApiTags('catalog/recipes/drafts')
@ApiBearerAuth()
@Roles(...FULL_ACCESS_ROLES)
@Controller('catalog/recipes/drafts')
export class RecipeDraftsController {
  constructor(private readonly draftsService: RecipeDraftsService) {}

  @Get()
  @ApiQuery({ name: 'finishedProductId', required: true })
  @ApiOperation({
    summary:
      "Retourne le brouillon de l'utilisateur courant pour ce produit fini, ou 204 sans contenu si aucun n'existe.",
  })
  async findForProduct(
    @CurrentUser() user: AuthenticatedUser,
    @Query('finishedProductId') finishedProductId: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!finishedProductId) {
      throw new BadRequestException(
        'Le paramètre finishedProductId est obligatoire.',
      );
    }
    const draft = await this.draftsService.findForProduct(
      user.id,
      finishedProductId,
    );
    // Un contrôleur NestJS qui retourne `null` envoie un corps vide (pas le texte
    // JSON "null"), ce que `response.json()` côté client ne peut pas parser : on
    // signale donc explicitement l'absence de brouillon par 204, un état normal
    // (voir client API frontend, qui traite déjà 204 comme "pas de contenu").
    if (!draft) {
      res.status(HttpStatus.NO_CONTENT);
      return;
    }
    return draft;
  }

  @Put()
  @ApiOperation({
    summary:
      'Enregistre (crée ou met à jour) le brouillon de l’utilisateur courant pour ce produit fini.',
  })
  upsert(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SaveRecipeDraftDto,
  ) {
    return this.draftsService.upsert(user.siteId, user.id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Supprime un brouillon.' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.draftsService.remove(user.id, id);
  }
}
