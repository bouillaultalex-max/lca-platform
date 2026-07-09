import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FeedbackService, FeedbackWithUser } from './feedback.service';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequireSystemAdmin } from '../auth/require-system-admin.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { Feedback } from '../../generated/prisma/client';

@ApiTags('feedback')
@ApiBearerAuth()
@Controller('feedback')
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Post()
  @ApiOperation({
    summary:
      'Envoie un retour (bug, idée, amélioration, question) — ouvert à tout utilisateur authentifié, y compris les rôles en lecture seule.',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateFeedbackDto,
  ): Promise<Feedback> {
    return this.feedbackService.create(user.siteId, user.id, dto);
  }

  @Get()
  @RequireSystemAdmin()
  @ApiOperation({
    summary:
      'Liste les retours, du plus récent au plus ancien (administrateurs système uniquement).',
  })
  findAll(@CurrentUser() user: AuthenticatedUser): Promise<FeedbackWithUser[]> {
    return this.feedbackService.findAll(user.siteId);
  }

  @Patch(':id/treated')
  @RequireSystemAdmin()
  @ApiOperation({
    summary:
      'Marque un retour comme traité (administrateurs système uniquement).',
  })
  markAsTreated(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<Feedback> {
    return this.feedbackService.markAsTreated(user.siteId, id);
  }
}
