import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateMarketDto } from './dto/create-market.dto';
import { UpdateMarketDto } from './dto/update-market.dto';
import { Market } from '../../../generated/prisma/client';

@Injectable()
export class MarketsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(siteId: string): Promise<Market[]> {
    return this.prisma.market.findMany({
      where: { siteId },
      orderBy: { code: 'asc' },
    });
  }

  async findOne(siteId: string, id: string): Promise<Market> {
    const market = await this.prisma.market.findFirst({
      where: { id, siteId },
    });
    if (!market) {
      throw new NotFoundException(`Marché ${id} introuvable.`);
    }
    return market;
  }

  create(siteId: string, dto: CreateMarketDto): Promise<Market> {
    return this.prisma.market.create({ data: { siteId, ...dto } });
  }

  async update(
    siteId: string,
    id: string,
    dto: UpdateMarketDto,
  ): Promise<Market> {
    await this.findOne(siteId, id);
    return this.prisma.market.update({ where: { id }, data: dto });
  }

  /** "Suppression" = désactivation uniquement, cohérent avec SuppliersService/MachinesService. */
  async deactivate(siteId: string, id: string): Promise<Market> {
    await this.findOne(siteId, id);
    return this.prisma.market.update({
      where: { id },
      data: { active: false },
    });
  }
}
