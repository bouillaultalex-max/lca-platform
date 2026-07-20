import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProductFamilyDto } from './dto/create-product-family.dto';
import { UpdateProductFamilyDto } from './dto/update-product-family.dto';
import { ProductFamily } from '../../../generated/prisma/client';

@Injectable()
export class ProductFamiliesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(siteId: string): Promise<ProductFamily[]> {
    return this.prisma.productFamily.findMany({
      where: { siteId },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(siteId: string, id: string): Promise<ProductFamily> {
    const productFamily = await this.prisma.productFamily.findFirst({
      where: { id, siteId },
    });
    if (!productFamily) {
      throw new NotFoundException(`Famille commerciale ${id} introuvable.`);
    }
    return productFamily;
  }

  create(siteId: string, dto: CreateProductFamilyDto): Promise<ProductFamily> {
    return this.prisma.productFamily.create({ data: { siteId, ...dto } });
  }

  async update(
    siteId: string,
    id: string,
    dto: UpdateProductFamilyDto,
  ): Promise<ProductFamily> {
    await this.findOne(siteId, id);
    return this.prisma.productFamily.update({ where: { id }, data: dto });
  }

  /** "Suppression" = désactivation uniquement, cohérent avec SuppliersService/MachinesService/MarketsService. */
  async deactivate(siteId: string, id: string): Promise<ProductFamily> {
    await this.findOne(siteId, id);
    return this.prisma.productFamily.update({
      where: { id },
      data: { active: false },
    });
  }
}
