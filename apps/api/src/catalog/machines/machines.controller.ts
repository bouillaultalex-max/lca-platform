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
import { MachinesService } from './machines.service';
import { CreateMachineDto } from './dto/create-machine.dto';
import { UpdateMachineDto } from './dto/update-machine.dto';
import { CurrentUser } from '../../auth/current-user.decorator';
import { Roles } from '../../auth/roles.decorator';
import { FULL_ACCESS_ROLES } from '../../auth/roles.constants';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user';
import { Machine } from '../../../generated/prisma/client';

@ApiTags('catalog/machines')
@ApiBearerAuth()
@Roles(...FULL_ACCESS_ROLES)
@Controller('catalog/machines')
export class MachinesController {
  constructor(private readonly machinesService: MachinesService) {}

  @Get()
  @ApiOperation({ summary: 'Liste les machines du site.' })
  findAll(@CurrentUser() user: AuthenticatedUser): Promise<Machine[]> {
    return this.machinesService.findAll(user.siteId);
  }

  @Get(':id')
  @ApiOperation({ summary: "Détail d'une machine." })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<Machine> {
    return this.machinesService.findOne(user.siteId, id);
  }

  @Post()
  @ApiOperation({ summary: 'Crée une machine.' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateMachineDto,
  ): Promise<Machine> {
    return this.machinesService.create(user.siteId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Met à jour une machine existante.' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateMachineDto,
  ): Promise<Machine> {
    return this.machinesService.update(user.siteId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary:
      "Désactive une machine (aucune suppression physique, préserve l'historique).",
  })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<Machine> {
    return this.machinesService.deactivate(user.siteId, id);
  }
}
