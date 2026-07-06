import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BatchStopsService } from './batch-stops.service';
import { CreateBatchStopDto } from './dto/create-batch-stop.dto';
import { EndBatchStopDto } from './dto/end-batch-stop.dto';
import { CurrentUser } from '../../auth/current-user.decorator';
import { Roles } from '../../auth/roles.decorator';
import { FULL_ACCESS_ROLES } from '../../auth/roles.constants';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user';
import { BatchStop } from '../../../generated/prisma/client';

@ApiTags('production/batch-stops')
@ApiBearerAuth()
@Roles(...FULL_ACCESS_ROLES)
@Controller('production')
export class BatchStopsController {
  constructor(private readonly batchStopsService: BatchStopsService) {}

  @Get('batches/:id/stops')
  @ApiOperation({
    summary: "Liste les arrêts d'un batch, du plus récent au plus ancien.",
  })
  findAllByBatch(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<BatchStop[]> {
    return this.batchStopsService.findAllByBatch(user.siteId, id);
  }

  @Post('batches/:id/stops')
  @ApiOperation({
    summary: 'Ouvre un arrêt sur un batch en cours (motif + heure de début).',
  })
  start(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateBatchStopDto,
  ): Promise<BatchStop> {
    return this.batchStopsService.start(user.siteId, id, dto);
  }

  @Patch('stops/:id/end')
  @ApiOperation({
    summary:
      'Clôture un arrêt (heure de fin) ; la durée en minutes est calculée automatiquement.',
  })
  end(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: EndBatchStopDto,
  ): Promise<BatchStop> {
    return this.batchStopsService.end(user.siteId, id, dto);
  }
}
