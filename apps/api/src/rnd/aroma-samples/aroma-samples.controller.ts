import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AromaSamplesService,
  PaginatedAromaSamples,
} from './aroma-samples.service';
import { QueryAromaSamplesDto } from './dto/query-aroma-samples.dto';
import { CurrentUser } from '../../auth/current-user.decorator';
import { Roles } from '../../auth/roles.decorator';
import { FULL_ACCESS_ROLES } from '../../auth/roles.constants';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user';

/**
 * Écran fermé à DIRECTION/DAF comme le reste des écrans R&D (voir
 * docs/regles-metier.md §1) : `@Roles(...FULL_ACCESS_ROLES)` restreint l'accès à
 * RESPONSABLE_LABORATOIRE/RESPONSABLE_ADJOINT. `siteId` vient toujours de
 * `@CurrentUser()` (JWT), jamais du corps ou de la requête — `QueryAromaSamplesDto` ne
 * porte pas ce champ. Aucune logique métier ici : ce contrôleur route vers
 * `AromaSamplesService.findAll()` et retourne son résultat tel quel.
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
}
