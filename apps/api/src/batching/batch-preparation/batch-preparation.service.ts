import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ArticleType } from '../../../generated/prisma/client';

export interface MaterialQuantity {
  kind: 'MATIERE_PREMIERE';
  articleId: string;
  articleName: string;
  /** Référence OpenSi de l'article, pour affichage (ex : tableau de faisabilité). */
  articleReference: string;
  /** Volume nécessaire, en litres. */
  volumeL: number;
  /** Masse nécessaire en kg ; `null` si la densité de l'article n'est pas renseignée. */
  massKg: number | null;
}

export interface PackagingQuantity {
  kind: 'PACKAGING';
  articleId: string;
  articleName: string;
  /** Référence OpenSi de l'article, pour affichage (ex : tableau de faisabilité). */
  articleReference: string;
  /** Quantité absolue nécessaire, dans l'unité de mesure de l'article. */
  quantity: number;
  unit: string;
}

export type IngredientQuantity = MaterialQuantity | PackagingQuantity;

/**
 * Calcule, à partir d'une recette et d'une quantité à produire, la quantité de
 * chaque matière première (volume + masse) et de chaque packaging (quantité
 * absolue) nécessaire — remplace le calcul aujourd'hui fait manuellement dans un
 * fichier Excel (voir docs/regles-metier.md §12). Calcul pur, à l'affichage
 * uniquement, aucune écriture.
 *
 * Volontairement agnostique du batch/de l'allocation appelant(e) (voir ADR 0006,
 * PRD-11) : `BatchFeasibilityService` l'appelle une fois sur `Batch.recipeId`/
 * `Batch.plannedQuantity` pour la matière première commune, puis une fois par
 * `BatchProductAllocation` (sa propre `recipeId`/`plannedQuantity`) pour le
 * packaging — cette méthode ne change jamais de forme, seule sa réutilisation par
 * l'appelant diffère.
 */
@Injectable()
export class BatchPreparationService {
  constructor(private readonly prisma: PrismaService) {}

  async computeIngredientQuantities(
    siteId: string,
    recipeId: string,
    quantityToProduce: number,
  ): Promise<IngredientQuantity[]> {
    if (quantityToProduce <= 0) {
      throw new BadRequestException(
        'La quantité à produire doit être positive.',
      );
    }

    const recipe = await this.prisma.recipe.findFirst({
      where: { id: recipeId, siteId },
      include: { lines: { include: { article: true } } },
    });
    if (!recipe) {
      throw new NotFoundException(`Recette ${recipeId} introuvable.`);
    }

    // Le format est en mL, la quantité à produire en nombre d'unités (flacons) :
    // le volume total à préparer, en litres, sert de base au calcul des % de matière première.
    const volumeTotalL = (recipe.format * quantityToProduce) / 1000;

    return recipe.lines.map((line): IngredientQuantity => {
      if (line.article.type === ArticleType.MATIERE_PREMIERE) {
        const volumeL = volumeTotalL * (Number(line.quantityPerUnit) / 100);
        const density = line.article.densityKgPerL;
        return {
          kind: 'MATIERE_PREMIERE',
          articleId: line.article.id,
          articleName: line.article.name,
          articleReference: line.article.openSiReference,
          volumeL,
          massKg: density === null ? null : volumeL * Number(density),
        };
      }

      return {
        kind: 'PACKAGING',
        articleId: line.article.id,
        articleName: line.article.name,
        articleReference: line.article.openSiReference,
        quantity: Number(line.quantityPerUnit) * quantityToProduce,
        unit: line.article.unitOfMeasure,
      };
    });
  }
}
