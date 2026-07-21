import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  BatchClosureService,
  type BatchClosureResult,
} from './batch-closure.service';
import { CloseBatchDto } from './dto/close-batch.dto';
import { CurrentUser } from '../../auth/current-user.decorator';
import { Roles } from '../../auth/roles.decorator';
import { FULL_ACCESS_ROLES } from '../../auth/roles.constants';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user';

@ApiTags('production/batch-closure')
@ApiBearerAuth()
@Roles(...FULL_ACCESS_ROLES)
@Controller('production/batches')
export class BatchClosureController {
  constructor(private readonly batchClosureService: BatchClosureService) {}

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Clôture le batch : saisie finale (quantités, rebuts, heure de fin), génération d'un lot par allocation (ou d'un lot unique pour un batch historique sans allocation) et de leur généalogie, déduction du stock (FIFO) — en une seule transaction. La réponse expose `lots` (officiel) et `lot` (alias temporaire vers le premier lot, pour compatibilité). Payload : `producedQuantity`/`rejectedQuantity` racine pour un batch sans allocation ou à une seule allocation (compatibilité transitoire) ; `allocations[]` obligatoire au-delà d'une allocation.",
  })
  close(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CloseBatchDto,
  ): Promise<BatchClosureResult> {
    return this.batchClosureService.close(user.siteId, user.id, id, dto);
  }
}
