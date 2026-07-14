import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { SaveRecipeDraftDto } from './dto/save-recipe-draft.dto';
import { Prisma, RecipeDraft } from '../../../../generated/prisma/client';

export interface RecipeDraftContent {
  format: number | null;
  lines: Array<{
    articleId: string | null;
    quantityPerUnit: string | null;
    unit: string | null;
  }>;
}

/**
 * Brouillons de recettes (mini-jalon "Brouillons de recettes", voir
 * docs/adr/0004-brouillons-recettes.md) : un seul brouillon par utilisateur et par
 * produit fini, sans aucune validation métier — la validation n'intervient qu'à la
 * création finale de la recette (RecipesService.create), qui supprime alors le
 * brouillon correspondant. Jamais tracé dans AuditLog : donnée temporaire, pas une
 * écriture métier.
 */
@Injectable()
export class RecipeDraftsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Retourne `null` si aucun brouillon n'existe : c'est un état normal, pas une erreur. */
  findForProduct(
    userId: string,
    finishedProductId: string,
  ): Promise<RecipeDraft | null> {
    return this.prisma.recipeDraft.findUnique({
      where: { userId_finishedProductId: { userId, finishedProductId } },
    });
  }

  async upsert(
    siteId: string,
    userId: string,
    dto: SaveRecipeDraftDto,
  ): Promise<RecipeDraft> {
    await this.assertFinishedProductExists(siteId, dto.finishedProductId);

    const existing = await this.prisma.recipeDraft.findUnique({
      where: {
        userId_finishedProductId: {
          userId,
          finishedProductId: dto.finishedProductId,
        },
      },
    });

    if (
      existing &&
      !dto.force &&
      dto.expectedUpdatedAt &&
      new Date(dto.expectedUpdatedAt).getTime() !== existing.updatedAt.getTime()
    ) {
      throw new ConflictException(
        'Ce brouillon a été modifié depuis un autre poste ou un autre onglet.',
      );
    }

    const content: RecipeDraftContent = {
      format: dto.format ?? null,
      lines: dto.lines.map((line) => ({
        articleId: line.articleId ?? null,
        quantityPerUnit: line.quantityPerUnit ?? null,
        unit: line.unit ?? null,
      })),
    };

    return this.prisma.recipeDraft.upsert({
      where: {
        userId_finishedProductId: {
          userId,
          finishedProductId: dto.finishedProductId,
        },
      },
      create: {
        siteId,
        userId,
        finishedProductId: dto.finishedProductId,
        // Cast nécessaire : Prisma exige un type JSON avec signature d'index, que notre
        // interface `RecipeDraftContent` (volontairement typée précisément) n'a pas.
        content: content as unknown as Prisma.InputJsonValue,
      },
      update: { content: content as unknown as Prisma.InputJsonValue },
    });
  }

  async remove(userId: string, id: string): Promise<void> {
    const draft = await this.prisma.recipeDraft.findFirst({
      where: { id, userId },
    });
    if (!draft) {
      throw new NotFoundException(`Brouillon ${id} introuvable.`);
    }
    await this.prisma.recipeDraft.delete({ where: { id: draft.id } });
  }

  private async assertFinishedProductExists(
    siteId: string,
    finishedProductId: string,
  ): Promise<void> {
    const finishedProduct = await this.prisma.article.findFirst({
      where: { id: finishedProductId, siteId },
    });
    if (!finishedProduct) {
      throw new NotFoundException(
        `Produit fini ${finishedProductId} introuvable.`,
      );
    }
  }
}
