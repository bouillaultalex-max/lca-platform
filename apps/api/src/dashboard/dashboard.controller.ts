import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DashboardService, DashboardSummary } from './dashboard.service';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';

@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary')
  @ApiOperation({
    summary:
      'Compteurs de synthèse pour la vision globale du tableau de bord — ouvert à tout utilisateur authentifié.',
  })
  getSummary(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DashboardSummary> {
    return this.dashboardService.getSummary(user.siteId);
  }
}
