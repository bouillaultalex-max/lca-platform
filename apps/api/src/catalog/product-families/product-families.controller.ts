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
import { ProductFamiliesService } from './product-families.service';
import { CreateProductFamilyDto } from './dto/create-product-family.dto';
import { UpdateProductFamilyDto } from './dto/update-product-family.dto';
import { CurrentUser } from '../../auth/current-user.decorator';
import { Roles } from '../../auth/roles.decorator';
import { FULL_ACCESS_ROLES } from '../../auth/roles.constants';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user';
import { ProductFamily } from '../../../generated/prisma/client';

@ApiTags('catalog/product-families')
@ApiBearerAuth()
@Roles(...FULL_ACCESS_ROLES)
@Controller('catalog/product-families')
export class ProductFamiliesController {
  constructor(
    private readonly productFamiliesService: ProductFamiliesService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Liste les familles commerciales du site.' })
  findAll(@CurrentUser() user: AuthenticatedUser): Promise<ProductFamily[]> {
    return this.productFamiliesService.findAll(user.siteId);
  }

  @Get(':id')
  @ApiOperation({ summary: "Détail d'une famille commerciale." })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<ProductFamily> {
    return this.productFamiliesService.findOne(user.siteId, id);
  }

  @Post()
  @ApiOperation({ summary: 'Crée une famille commerciale.' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateProductFamilyDto,
  ): Promise<ProductFamily> {
    return this.productFamiliesService.create(user.siteId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Met à jour une famille commerciale existante.' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateProductFamilyDto,
  ): Promise<ProductFamily> {
    return this.productFamiliesService.update(user.siteId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary:
      "Désactive une famille commerciale (aucune suppression physique, préserve l'historique).",
  })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<ProductFamily> {
    return this.productFamiliesService.deactivate(user.siteId, id);
  }
}
