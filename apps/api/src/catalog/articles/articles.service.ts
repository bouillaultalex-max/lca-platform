import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateArticleDto } from './dto/create-article.dto';
import { UpdateArticleDto } from './dto/update-article.dto';
import { Article, ArticleType, Prisma } from '../../../generated/prisma/client';

@Injectable()
export class ArticlesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(siteId: string, type?: ArticleType): Promise<Article[]> {
    return this.prisma.article.findMany({
      where: { siteId, ...(type ? { type } : {}) },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(siteId: string, id: string): Promise<Article> {
    const article = await this.prisma.article.findFirst({
      where: { id, siteId },
    });
    if (!article) {
      throw new NotFoundException(`Article ${id} introuvable.`);
    }
    return article;
  }

  async create(siteId: string, dto: CreateArticleDto): Promise<Article> {
    try {
      return await this.prisma.article.create({ data: { siteId, ...dto } });
    } catch (error) {
      throw this.toFriendlyError(error, dto.openSiReference);
    }
  }

  async update(
    siteId: string,
    id: string,
    dto: UpdateArticleDto,
  ): Promise<Article> {
    const existing = await this.findOne(siteId, id);

    if (dto.type && dto.type !== existing.type) {
      await this.assertTypeCanBeChanged(id);
    }

    try {
      return await this.prisma.article.update({ where: { id }, data: dto });
    } catch (error) {
      throw this.toFriendlyError(error, dto.openSiReference);
    }
  }

  /**
   * Le type ne peut être changé que si l'article n'a encore jamais été utilisé :
   * aucune recette, aucun stock, aucune généalogie de lot. Un import ou un
   * `StockItem` n'a pas besoin d'être vérifié séparément (voir design validé) :
   * un `StockItem` n'existe que si `stockLots`/`stockMovements` existent déjà.
   */
  private async assertTypeCanBeChanged(id: string): Promise<void> {
    const usage = await this.prisma.article.findUnique({
      where: { id },
      select: {
        _count: {
          select: {
            recipeLines: true,
            recipesAsFinishedProduct: true,
            stockLots: true,
            stockMovements: true,
            genealogyLines: true,
          },
        },
      },
    });

    const isUsed = Object.values(usage?._count ?? {}).some(
      (count) => count > 0,
    );
    if (isUsed) {
      throw new ConflictException(
        'Le type de cet article ne peut plus être modifié car il est déjà utilisé dans le stock, une recette ou une production. Désactivez cet article et créez-en un nouveau.',
      );
    }
  }

  /**
   * "Suppression" = désactivation uniquement (jamais de suppression physique) :
   * un article peut être référencé par l'historique (recettes, stock, coûts figés).
   */
  async deactivate(siteId: string, id: string): Promise<Article> {
    await this.findOne(siteId, id);
    return this.prisma.article.update({
      where: { id },
      data: { active: false },
    });
  }

  private toFriendlyError(error: unknown, openSiReference?: string): Error {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return new ConflictException(
        `La référence OpenSi "${openSiReference}" est déjà utilisée sur ce site.`,
      );
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}
