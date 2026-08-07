import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  AromaSamplesService,
  PaginatedAromaSamples,
} from './aroma-samples.service';
import { QueryAromaSamplesDto } from './dto/query-aroma-samples.dto';
import { AromaSampleDetailResponseDto } from './dto/aroma-sample-detail-response.dto';
import { CurrentUser } from '../../auth/current-user.decorator';
import { Roles } from '../../auth/roles.decorator';
import { FULL_ACCESS_ROLES } from '../../auth/roles.constants';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user';

/**
 * Écran fermé à DIRECTION/DAF comme le reste des écrans R&D (voir
 * docs/regles-metier.md §1) : `@Roles(...FULL_ACCESS_ROLES)` restreint l'accès à
 * RESPONSABLE_LABORATOIRE/RESPONSABLE_ADJOINT. `siteId` vient toujours de
 * `@CurrentUser()` (JWT), jamais du corps, de la requête ou de l'URL —
 * `QueryAromaSamplesDto` ne porte pas ce champ, et `findOne` ne reçoit que `id`
 * (route). Aucune logique métier ici, aucune requête Prisma : ce contrôleur route
 * vers `AromaSamplesService` et retourne son résultat tel quel.
 */
@ApiTags('rnd/aroma-samples')
@ApiBearerAuth()
@Roles(...FULL_ACCESS_ROLES)
@Controller('rnd/aroma-samples')
export class AromaSamplesController {
  constructor(private readonly aromaSamplesService: AromaSamplesService) {}

  @Get()
  @ApiOperation({
    summary:
      'Liste paginée des échantillons d’aromathèque du site courant, avec recherche globale, filtres exacts (catégorie, actif/inactif) et tri.',
  })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryAromaSamplesDto,
  ): Promise<PaginatedAromaSamples> {
    return this.aromaSamplesService.findAll(user.siteId, query);
  }

  @Get(':id')
  @ApiOperation({
    summary:
      'Fiche détail d’un échantillon d’aromathèque du site courant, avec le dernier import l’ayant créé ou mis à jour.',
  })
  @ApiResponse({ status: 200, type: AromaSampleDetailResponseDto })
  @ApiResponse({
    status: 404,
    description: 'Échantillon introuvable pour ce site.',
  })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<AromaSampleDetailResponseDto> {
    return this.aromaSamplesService.findOne(user.siteId, id);
  }
}
