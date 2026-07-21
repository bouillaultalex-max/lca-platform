import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BatchProductAllocationsService } from './batch-product-allocations.service';
import { AddBatchProductAllocationDto } from './dto/add-batch-product-allocation.dto';
import { CurrentUser } from '../../auth/current-user.decorator';
import { Roles } from '../../auth/roles.decorator';
import { FULL_ACCESS_ROLES } from '../../auth/roles.constants';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user';
import { BatchProductAllocation } from '../../../generated/prisma/client';

/**
 * Fermé à DIRECTION/DAF, comme le reste du module `batching` (voir docs/regles-metier.md
 * §1). N'expose volontairement pas `createInitialAllocation` : elle n'est appelée que
 * depuis `BatchesService.create()` (voir plan-developpement.md, étape 6), jamais
 * directement par un client HTTP.
 */
@ApiTags('batching/batch-product-allocations')
@ApiBearerAuth()
@Roles(...FULL_ACCESS_ROLES)
@Controller('batching/batches/:batchId/allocations')
export class BatchProductAllocationsController {
  constructor(
    private readonly batchProductAllocationsService: BatchProductAllocationsService,
  ) {}

  @Get()
  @ApiOperation({ summary: "Liste les allocations d'un batch." })
  listAllocations(
    @CurrentUser() user: AuthenticatedUser,
    @Param('batchId') batchId: string,
  ): Promise<BatchProductAllocation[]> {
    return this.batchProductAllocationsService.listAllocations(
      user.siteId,
      batchId,
    );
  }

  @Post()
  @ApiOperation({
    summary:
      "Ajoute une allocation supplémentaire à un batch (via un marché déjà décliné, ou directement un produit sans famille commerciale), tant que le conditionnement n'est pas atteint.",
  })
  addAllocation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('batchId') batchId: string,
    @Body() dto: AddBatchProductAllocationDto,
  ): Promise<BatchProductAllocation> {
    return this.batchProductAllocationsService.addAllocation(
      user.siteId,
      batchId,
      dto,
    );
  }
}
