import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ImportLogsService } from './import-logs.service';
import { ListImportLogsDto } from './dto/list-import-logs.dto';
import { CurrentUser } from '../../auth/current-user.decorator';
import { Roles } from '../../auth/roles.decorator';
import { FULL_ACCESS_ROLES } from '../../auth/roles.constants';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user';
import { ImportLog } from '../../../generated/prisma/client';

/**
 * Historique des imports OpenSi : écran fermé à DIRECTION/DAF, comme le reste
 * des écrans d'import (voir docs/regles-metier.md §1).
 */
@ApiTags('import-export/logs')
@ApiBearerAuth()
@Controller('import-export/logs')
@Roles(...FULL_ACCESS_ROLES)
export class ImportLogsController {
  constructor(private readonly importLogsService: ImportLogsService) {}

  @Get()
  @ApiOperation({
    summary:
      'Historique des imports OpenSi (prévisualisés et validés), du plus récent au plus ancien.',
  })
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListImportLogsDto,
  ): Promise<ImportLog[]> {
    return this.importLogsService.findAll(user.siteId, query.type);
  }
}
