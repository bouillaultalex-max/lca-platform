import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateMachineDto } from './dto/create-machine.dto';
import { UpdateMachineDto } from './dto/update-machine.dto';
import { Machine } from '../../../generated/prisma/client';

@Injectable()
export class MachinesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(siteId: string): Promise<Machine[]> {
    return this.prisma.machine.findMany({
      where: { siteId },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(siteId: string, id: string): Promise<Machine> {
    const machine = await this.prisma.machine.findFirst({
      where: { id, siteId },
    });
    if (!machine) {
      throw new NotFoundException(`Machine ${id} introuvable.`);
    }
    return machine;
  }

  create(siteId: string, dto: CreateMachineDto): Promise<Machine> {
    return this.prisma.machine.create({ data: { siteId, ...dto } });
  }

  async update(
    siteId: string,
    id: string,
    dto: UpdateMachineDto,
  ): Promise<Machine> {
    await this.findOne(siteId, id);
    return this.prisma.machine.update({ where: { id }, data: dto });
  }

  /** "Suppression" = désactivation uniquement, cohérent avec ArticlesService. */
  async deactivate(siteId: string, id: string): Promise<Machine> {
    await this.findOne(siteId, id);
    return this.prisma.machine.update({
      where: { id },
      data: { active: false },
    });
  }
}
