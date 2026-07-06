import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateRecipeDto } from './dto/create-recipe.dto';
import {
  Article,
  ArticleType,
  Prisma,
  Recipe,
  RecipeLine,
  RecipeStatus,
} from '../../../generated/prisma/client';

type RecipeWithLines = Recipe & { lines: RecipeLine[] };

// Tolérance de rounding pour la validation "total des % de matière première = 100".
const PERCENTAGE_TOLERANCE = new Prisma.Decimal('0.01');
const ONE_HUNDRED = new Prisma.Decimal(100);

@Injectable()
export class RecipesService {
  constructor(private readonly prisma: PrismaService) {}

  findAllByProduct(
    siteId: string,
    finishedProductId: string,
  ): Promise<RecipeWithLines[]> {
    return this.prisma.recipe.findMany({
      where: { siteId, finishedProductId },
      include: { lines: true },
      orderBy: [{ format: 'asc' }, { version: 'desc' }],
    });
  }

  async findOne(siteId: string, id: string): Promise<RecipeWithLines> {
    const recipe = await this.prisma.recipe.findFirst({
      where: { id, siteId },
      include: { lines: true },
    });
    if (!recipe) {
      throw new NotFoundException(`Recette ${id} introuvable.`);
    }
    return recipe;
  }

  /**
   * Crée toujours une nouvelle recette. S'il existe déjà une version ACTIVE pour ce
   * produit fini + format, elle est archivée dans la même transaction et la nouvelle
   * recette reçoit le numéro de version suivant (voir docs/regles-metier.md §2).
   */
  async create(siteId: string, dto: CreateRecipeDto): Promise<RecipeWithLines> {
    const finishedProduct = await this.getActiveFinishedProduct(
      siteId,
      dto.finishedProductId,
    );
    const articlesById = await this.getValidatedLineArticles(siteId, dto.lines);
    this.assertPercentageTotal(dto.lines, articlesById);

    const existingRecipes = await this.prisma.recipe.findMany({
      where: {
        siteId,
        finishedProductId: finishedProduct.id,
        format: dto.format,
      },
      orderBy: { version: 'desc' },
    });
    const previousActive = existingRecipes.find(
      (recipe) => recipe.status === RecipeStatus.ACTIVE,
    );
    const nextVersion =
      existingRecipes.length > 0 ? existingRecipes[0].version + 1 : 1;

    return this.prisma.$transaction(async (tx) => {
      if (previousActive) {
        await tx.recipe.update({
          where: { id: previousActive.id },
          data: { status: RecipeStatus.ARCHIVEE },
        });
      }

      return tx.recipe.create({
        data: {
          siteId,
          finishedProductId: finishedProduct.id,
          format: dto.format,
          version: nextVersion,
          status: RecipeStatus.ACTIVE,
          lines: {
            create: dto.lines.map((line) => ({
              articleId: line.articleId,
              quantityPerUnit: line.quantityPerUnit,
              unit: line.unit,
            })),
          },
        },
        include: { lines: true },
      });
    });
  }

  /** Archive une recette sans créer de remplaçante (retrait d'une formule). */
  async archive(siteId: string, id: string): Promise<Recipe> {
    await this.findOne(siteId, id);
    return this.prisma.recipe.update({
      where: { id },
      data: { status: RecipeStatus.ARCHIVEE },
    });
  }

  private async getActiveFinishedProduct(
    siteId: string,
    finishedProductId: string,
  ): Promise<Article> {
    const finishedProduct = await this.prisma.article.findFirst({
      where: { id: finishedProductId, siteId },
    });
    if (!finishedProduct) {
      throw new NotFoundException(
        `Produit fini ${finishedProductId} introuvable.`,
      );
    }
    if (finishedProduct.type !== ArticleType.PRODUIT_FINI) {
      throw new BadRequestException(
        "L'article référencé par la recette doit être de type PRODUIT_FINI.",
      );
    }
    if (!finishedProduct.active) {
      throw new BadRequestException(
        'Impossible de créer une recette pour un produit fini désactivé.',
      );
    }
    return finishedProduct;
  }

  private async getValidatedLineArticles(
    siteId: string,
    lines: CreateRecipeDto['lines'],
  ): Promise<Map<string, Article>> {
    const articleIds = lines.map((line) => line.articleId);
    if (new Set(articleIds).size !== articleIds.length) {
      throw new BadRequestException(
        'Un même article ne peut apparaître qu’une seule fois dans une recette.',
      );
    }

    const articles = await this.prisma.article.findMany({
      where: { id: { in: articleIds }, siteId },
    });
    if (articles.length !== articleIds.length) {
      throw new BadRequestException(
        'Un ou plusieurs articles de la recette sont introuvables sur ce site.',
      );
    }

    const inactiveArticle = articles.find((article) => !article.active);
    if (inactiveArticle) {
      throw new BadRequestException(
        `L'article "${inactiveArticle.name}" est désactivé et ne peut pas être utilisé dans une nouvelle recette.`,
      );
    }

    const finishedProductLine = articles.find(
      (article) => article.type === ArticleType.PRODUIT_FINI,
    );
    if (finishedProductLine) {
      throw new BadRequestException(
        `L'article "${finishedProductLine.name}" est un produit fini : une ligne de recette doit référencer une matière première ou un packaging.`,
      );
    }

    return new Map(articles.map((article) => [article.id, article]));
  }

  private assertPercentageTotal(
    lines: CreateRecipeDto['lines'],
    articlesById: Map<string, Article>,
  ): void {
    const percentageTotal = lines
      .filter(
        (line) =>
          articlesById.get(line.articleId)?.type ===
          ArticleType.MATIERE_PREMIERE,
      )
      .reduce(
        (total, line) => total.plus(line.quantityPerUnit),
        new Prisma.Decimal(0),
      );

    if (
      percentageTotal.minus(ONE_HUNDRED).abs().greaterThan(PERCENTAGE_TOLERANCE)
    ) {
      throw new BadRequestException(
        `Le total des pourcentages des lignes de matière première doit être égal à 100% (actuellement ${percentageTotal.toString()}%).`,
      );
    }
  }
}
