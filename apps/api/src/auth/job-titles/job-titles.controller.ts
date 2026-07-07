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
import { JobTitlesService } from './job-titles.service';
import { CreateJobTitleDto } from './dto/create-job-title.dto';
import { UpdateJobTitleDto } from './dto/update-job-title.dto';
import { CurrentUser } from '../current-user.decorator';
import { RequireSystemAdmin } from '../require-system-admin.decorator';
import type { AuthenticatedUser } from '../types/authenticated-user';
import { JobTitle } from '../../../generated/prisma/client';

/**
 * Gestion des fonctions métier — réservée aux administrateurs système, comme le
 * reste de la gestion des utilisateurs (voir docs/regles-metier.md, Jalon 2.5).
 */
@ApiTags('auth/job-titles')
@ApiBearerAuth()
@RequireSystemAdmin()
@Controller('auth/job-titles')
export class JobTitlesController {
  constructor(private readonly jobTitlesService: JobTitlesService) {}

  @Get()
  @ApiOperation({ summary: 'Liste les fonctions métier du site.' })
  findAll(@CurrentUser() user: AuthenticatedUser): Promise<JobTitle[]> {
    return this.jobTitlesService.findAll(user.siteId);
  }

  @Post()
  @ApiOperation({ summary: 'Crée une fonction métier.' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateJobTitleDto,
  ): Promise<JobTitle> {
    return this.jobTitlesService.create(user.siteId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Renomme une fonction métier existante.' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateJobTitleDto,
  ): Promise<JobTitle> {
    return this.jobTitlesService.update(user.siteId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary:
      "Désactive une fonction métier (aucune suppression physique, préserve l'historique).",
  })
  deactivate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<JobTitle> {
    return this.jobTitlesService.deactivate(user.siteId, id);
  }

  @Post(':id/reactivate')
  @ApiOperation({ summary: 'Réactive une fonction métier désactivée.' })
  reactivate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<JobTitle> {
    return this.jobTitlesService.reactivate(user.siteId, id);
  }
}
