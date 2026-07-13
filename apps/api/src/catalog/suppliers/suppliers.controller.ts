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
import { SuppliersService } from './suppliers.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { CurrentUser } from '../../auth/current-user.decorator';
import { Roles } from '../../auth/roles.decorator';
import { FULL_ACCESS_ROLES } from '../../auth/roles.constants';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user';
import { Supplier } from '../../../generated/prisma/client';

@ApiTags('catalog/suppliers')
@ApiBearerAuth()
@Roles(...FULL_ACCESS_ROLES)
@Controller('catalog/suppliers')
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Get()
  @ApiOperation({ summary: 'Liste les fournisseurs du site.' })
  findAll(@CurrentUser() user: AuthenticatedUser): Promise<Supplier[]> {
    return this.suppliersService.findAll(user.siteId);
  }

  @Get(':id')
  @ApiOperation({ summary: "Détail d'un fournisseur." })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<Supplier> {
    return this.suppliersService.findOne(user.siteId, id);
  }

  @Post()
  @ApiOperation({ summary: 'Crée un fournisseur.' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSupplierDto,
  ): Promise<Supplier> {
    return this.suppliersService.create(user.siteId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Met à jour un fournisseur existant.' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateSupplierDto,
  ): Promise<Supplier> {
    return this.suppliersService.update(user.siteId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary:
      "Désactive un fournisseur (aucune suppression physique, préserve l'historique).",
  })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<Supplier> {
    return this.suppliersService.deactivate(user.siteId, id);
  }
}
