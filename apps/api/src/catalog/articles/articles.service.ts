import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateArticleDto } from './dto/create-article.dto';
import { UpdateArticleDto } from './dto/update-article.dto';
import { Article, ArticleType, Prisma } from '../../../generated/prisma/client';

/**
 * Types pouvant recevoir un fournisseur principal (voir retour Kevin : le
 * laboratoire gère aussi les commandes de packaging, pas seulement les matières
 * premières). PRODUIT_FINI reste exclu.
 */
const SUPPLIER_ELIGIBLE_TYPES: ArticleType[] = [
  ArticleType.MATIERE_PREMIERE,
  ArticleType.PACKAGING,
];

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
    if (dto.supplierId) {
      await this.assertSupplierAssignment(siteId, dto.type, dto.supplierId);
    }
    if (dto.productFamilyId || dto.marketId) {
      this.assertMarketRequiresProductFamily(dto.productFamilyId, dto.marketId);
      if (dto.productFamilyId) {
        await this.assertProductFamilyExists(siteId, dto.productFamilyId);
      }
      if (dto.marketId) {
        await this.assertMarketExists(siteId, dto.marketId);
      }
    }
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

    const resolvedType = dto.type ?? existing.type;
    if (dto.supplierId !== undefined) {
      await this.assertSupplierAssignment(siteId, resolvedType, dto.supplierId);
    }

    if (dto.productFamilyId !== undefined || dto.marketId !== undefined) {
      const resolvedProductFamilyId =
        dto.productFamilyId !== undefined
          ? dto.productFamilyId
          : existing.productFamilyId;
      const resolvedMarketId =
        dto.marketId !== undefined ? dto.marketId : existing.marketId;
      this.assertMarketRequiresProductFamily(
        resolvedProductFamilyId,
        resolvedMarketId,
      );
      // Seules les valeurs effectivement écrites par cette requête sont
      // revérifiées en base — une valeur héritée de l'existant a déjà été
      // validée lors de sa propre affectation (voir assertTypeCanBeChanged,
      // même principe de ne pas revalider ce qui n'a pas changé).
      if (dto.productFamilyId) {
        await this.assertProductFamilyExists(siteId, dto.productFamilyId);
      }
      if (dto.marketId) {
        await this.assertMarketExists(siteId, dto.marketId);
      }
    }

    const data: Prisma.ArticleUncheckedUpdateInput = { ...dto };
    if (!SUPPLIER_ELIGIBLE_TYPES.includes(resolvedType)) {
      // Le fournisseur principal ne concerne pas les produits finis : on
      // efface toute affectation existante si l'article devient PRODUIT_FINI.
      data.supplierId = null;
    }

    try {
      return await this.prisma.article.update({ where: { id }, data });
    } catch (error) {
      throw this.toFriendlyError(error, dto.openSiReference);
    }
  }

  /**
   * Le fournisseur principal ne peut être renseigné que pour une matière première
   * ou un packaging (jamais un produit fini — voir retour Kevin, le laboratoire
   * gère aussi les commandes de packaging), et doit référencer un fournisseur
   * existant du même site (un seul fournisseur par article, pas de gestion de
   * prix/commandes en V0.9).
   */
  private async assertSupplierAssignment(
    siteId: string,
    type: ArticleType,
    supplierId: string,
  ): Promise<void> {
    if (!SUPPLIER_ELIGIBLE_TYPES.includes(type)) {
      throw new BadRequestException(
        'Le fournisseur principal ne peut être renseigné que pour une matière première ou un packaging.',
      );
    }
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: supplierId, siteId },
    });
    if (!supplier) {
      throw new NotFoundException(`Fournisseur ${supplierId} introuvable.`);
    }
  }

  /**
   * Famille commerciale et marché de déclinaison (voir ADR 0006 / docs/modele-donnees.md
   * §1, PRD-11) : le marché ne peut être renseigné que si la famille commerciale l'est
   * aussi — règle de service documentée dans l'ADR, vérifiée sur les valeurs résolues
   * (nouvelle valeur si fournie, sinon valeur déjà existante). L'unicité du couple
   * (productFamilyId, marketId) n'est volontairement pas revérifiée ici : elle est déjà
   * garantie par la contrainte Prisma posée en PRD11-01 (voir toFriendlyError).
   */
  private assertMarketRequiresProductFamily(
    resolvedProductFamilyId: string | null | undefined,
    resolvedMarketId: string | null | undefined,
  ): void {
    if (resolvedMarketId && !resolvedProductFamilyId) {
      throw new BadRequestException(
        'Le marché ne peut être renseigné que si la famille commerciale est également renseignée.',
      );
    }
  }

  private async assertProductFamilyExists(
    siteId: string,
    productFamilyId: string,
  ): Promise<void> {
    const productFamily = await this.prisma.productFamily.findFirst({
      where: { id: productFamilyId, siteId },
    });
    if (!productFamily) {
      throw new NotFoundException(
        `Famille commerciale ${productFamilyId} introuvable.`,
      );
    }
  }

  private async assertMarketExists(
    siteId: string,
    marketId: string,
  ): Promise<void> {
    const market = await this.prisma.market.findFirst({
      where: { id: marketId, siteId },
    });
    if (!market) {
      throw new NotFoundException(`Marché ${marketId} introuvable.`);
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
      // Avec le driver adapter pg (voir docs/adr/0002), `error.meta` ne porte pas de
      // `target` : le nom de la contrainte violée n'est disponible que dans le message
      // brut Postgres. Deux contraintes uniques distinctes existent désormais sur
      // `articles` (voir schema.prisma) — il faut les distinguer pour ne jamais renvoyer
      // le message "référence OpenSi" sur un conflit famille/marché, ou inversement.
      if (this.violatesProductFamilyMarketUniqueness(error)) {
        return new ConflictException(
          'Cette famille commerciale possède déjà une déclinaison pour ce marché.',
        );
      }
      return new ConflictException(
        `La référence OpenSi "${openSiReference}" est déjà utilisée sur ce site.`,
      );
    }
    return error instanceof Error ? error : new Error(String(error));
  }

  private violatesProductFamilyMarketUniqueness(
    error: Prisma.PrismaClientKnownRequestError,
  ): boolean {
    const meta = error.meta as
      | { driverAdapterError?: { cause?: { originalMessage?: string } } }
      | undefined;
    const originalMessage = meta?.driverAdapterError?.cause?.originalMessage;
    return (
      typeof originalMessage === 'string' &&
      originalMessage.includes('product_family_id_market_id')
    );
  }
}
