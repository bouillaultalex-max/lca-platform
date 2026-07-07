import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateJobTitleDto } from './dto/create-job-title.dto';
import { UpdateJobTitleDto } from './dto/update-job-title.dto';
import { JobTitle, Prisma } from '../../../generated/prisma/client';

/**
 * Fonctions métier (voir docs/adr — Jalon 2.5) : entité dédiée plutôt qu'un texte
 * libre sur `User`, pour éviter les doublons ("Responsable labo" / "Resp labo"...)
 * et permettre une réutilisation future (tableau de bord, statistiques par fonction).
 */
@Injectable()
export class JobTitlesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(siteId: string): Promise<JobTitle[]> {
    return this.prisma.jobTitle.findMany({
      where: { siteId },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(siteId: string, id: string): Promise<JobTitle> {
    const jobTitle = await this.prisma.jobTitle.findFirst({
      where: { id, siteId },
    });
    if (!jobTitle) {
      throw new NotFoundException(`Fonction métier ${id} introuvable.`);
    }
    return jobTitle;
  }

  async create(siteId: string, dto: CreateJobTitleDto): Promise<JobTitle> {
    try {
      return await this.prisma.jobTitle.create({ data: { siteId, ...dto } });
    } catch (error) {
      throw this.toFriendlyError(error, dto.name);
    }
  }

  async update(
    siteId: string,
    id: string,
    dto: UpdateJobTitleDto,
  ): Promise<JobTitle> {
    await this.findOne(siteId, id);
    try {
      return await this.prisma.jobTitle.update({ where: { id }, data: dto });
    } catch (error) {
      throw this.toFriendlyError(error, dto.name);
    }
  }

  /** "Suppression" = désactivation uniquement, cohérent avec Article/Machine/Recipe. */
  async deactivate(siteId: string, id: string): Promise<JobTitle> {
    await this.findOne(siteId, id);
    return this.prisma.jobTitle.update({
      where: { id },
      data: { active: false },
    });
  }

  async reactivate(siteId: string, id: string): Promise<JobTitle> {
    await this.findOne(siteId, id);
    return this.prisma.jobTitle.update({
      where: { id },
      data: { active: true },
    });
  }

  private toFriendlyError(error: unknown, name?: string): Error {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return new ConflictException(
        `La fonction métier "${name}" existe déjà sur ce site.`,
      );
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}
