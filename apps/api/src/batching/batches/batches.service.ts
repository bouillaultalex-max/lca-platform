import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BatchProductAllocationsService } from '../batch-product-allocations/batch-product-allocations.service';
import { CreateBatchDto } from './dto/create-batch.dto';
import {
  Batch,
  BatchStatus,
  RecipeStatus,
} from '../../../generated/prisma/client';

@Injectable()
export class BatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly batchProductAllocationsService: BatchProductAllocationsService,
  ) {}

  findAll(siteId: string): Promise<Batch[]> {
    return this.prisma.batch.findMany({
      where: { siteId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(siteId: string, id: string): Promise<Batch> {
    const batch = await this.prisma.batch.findFirst({ where: { id, siteId } });
    if (!batch) {
      throw new NotFoundException(`Batch ${id} introuvable.`);
    }
    return batch;
  }

  async create(
    siteId: string,
    userId: string,
    dto: CreateBatchDto,
  ): Promise<Batch> {
    const recipe = await this.prisma.recipe.findFirst({
      where: { id: dto.recipeId, siteId },
    });
    if (!recipe) {
      throw new NotFoundException(`Recette ${dto.recipeId} introuvable.`);
    }
    if (recipe.status !== RecipeStatus.ACTIVE) {
      throw new BadRequestException(
        'Impossible de créer un batch à partir d’une recette archivée.',
      );
    }

    const machine = await this.prisma.machine.findFirst({
      where: { id: dto.machineId, siteId },
    });
    if (!machine) {
      throw new NotFoundException(`Machine ${dto.machineId} introuvable.`);
    }
    if (!machine.active) {
      throw new BadRequestException(
        'Impossible de créer un batch sur une machine désactivée.',
      );
    }
    if (!machine.supportedFormats.includes(recipe.format)) {
      throw new BadRequestException(
        `La machine "${machine.name}" ne supporte pas le format ${recipe.format} ml de cette recette.`,
      );
    }

    // Le batch et sa première allocation sont créés dans la même transaction : voir
    // ADR 0006 / plan-developpement.md étape 6, aucune écriture partielle possible.
    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.batch.create({
        data: {
          siteId,
          recipeId: dto.recipeId,
          machineId: dto.machineId,
          format: recipe.format,
          plannedQuantity: dto.plannedQuantity,
          status: BatchStatus.PLANIFIE,
          createdByUserId: userId,
        },
      });

      await this.batchProductAllocationsService.createInitialAllocation(
        batch,
        recipe,
        tx,
      );

      return batch;
    });
  }

  /**
   * Modifie la quantité planifiée d'un batch, par exemple pour l'ajuster à la quantité
   * maximale réellement produisible signalée par l'analyse de faisabilité (voir
   * BatchFeasibilityService). Autorisé uniquement tant que le batch n'a pas démarré :
   * redimensionner un batch déjà en cours ou clôturé changerait rétroactivement les
   * besoins déjà vérifiés (ou déjà consommés) pour ce batch.
   */
  async updatePlannedQuantity(
    siteId: string,
    id: string,
    plannedQuantity: number,
  ): Promise<Batch> {
    const batch = await this.findOne(siteId, id);
    if (batch.status !== BatchStatus.PLANIFIE) {
      throw new BadRequestException(
        'Seule la quantité d’un batch encore planifié peut être modifiée.',
      );
    }
    return this.prisma.batch.update({
      where: { id },
      data: { plannedQuantity },
    });
  }
}
