import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { Supplier } from '../../../generated/prisma/client';

@Injectable()
export class SuppliersService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(siteId: string): Promise<Supplier[]> {
    return this.prisma.supplier.findMany({
      where: { siteId },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(siteId: string, id: string): Promise<Supplier> {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id, siteId },
    });
    if (!supplier) {
      throw new NotFoundException(`Fournisseur ${id} introuvable.`);
    }
    return supplier;
  }

  create(siteId: string, dto: CreateSupplierDto): Promise<Supplier> {
    return this.prisma.supplier.create({ data: { siteId, ...dto } });
  }

  async update(
    siteId: string,
    id: string,
    dto: UpdateSupplierDto,
  ): Promise<Supplier> {
    await this.findOne(siteId, id);
    return this.prisma.supplier.update({ where: { id }, data: dto });
  }

  /** "Suppression" = désactivation uniquement, cohérent avec ArticlesService/MachinesService. */
  async deactivate(siteId: string, id: string): Promise<Supplier> {
    await this.findOne(siteId, id);
    return this.prisma.supplier.update({
      where: { id },
      data: { active: false },
    });
  }
}
