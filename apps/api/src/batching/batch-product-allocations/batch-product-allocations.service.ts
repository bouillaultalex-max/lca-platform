import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  areMaterialFormulasCompatible,
  RecipeCompatibilityResult,
} from '../../catalog/recipes/recipe-compatibility';
import {
  Article,
  ArticleType,
  Batch,
  BatchProductAllocation,
  BatchStatus,
  BatchStep,
  Prisma,
  PrismaClient,
  Recipe,
  RecipeLine,
  RecipeStatus,
} from '../../../generated/prisma/client';

/**
 * Surface Prisma minimale nécessaire à `createInitialAllocation()` — satisfaite aussi
 * bien par `PrismaService` que par le client `tx` d'une transaction englobante (même
 * principe que `LotNumberGeneratorService`/`StockLotsService.receive()`), pour que
 * `BatchesService.create()` puisse l'appeler à l'intérieur de sa propre transaction
 * lorsqu'elle créera la première allocation (voir plan-developpement.md, étape 6).
 */
export interface BatchProductAllocationWriteClient {
  article: { findUnique: PrismaClient['article']['findUnique'] };
  batchProductAllocation: {
    create: PrismaClient['batchProductAllocation']['create'];
  };
}

type RecipeWithMaterialLines = Recipe & {
  lines: (RecipeLine & { article: { type: ArticleType } })[];
};

export interface AddBatchProductAllocationInput {
  marketId?: string;
  productId?: string;
  plannedQuantity: number;
}

/**
 * Point central de création et de gestion des allocations produit/marché d'un batch
 * (voir ADR 0006, PRD-11). Un batch représente un seul mélange commun ; chaque
 * `BatchProductAllocation` représente une sortie commerciale de ce mélange, avec sa
 * propre recette (résolue automatiquement, jamais choisie directement par
 * l'utilisateur) et éventuellement son propre marché.
 */
@Injectable()
export class BatchProductAllocationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Crée la première allocation d'un batch, à partir de la recette déjà choisie à sa
   * création. Aucune vérification de compatibilité à faire (rien à comparer pour une
   * première allocation) : le marché est simplement dérivé du produit fini de la
   * recette, s'il appartient à une famille commerciale.
   */
  async createInitialAllocation(
    batch: { id: string; plannedQuantity: number },
    recipe: { id: string; finishedProductId: string },
    client: BatchProductAllocationWriteClient = this.prisma,
  ): Promise<BatchProductAllocation> {
    const product = await client.article.findUnique({
      where: { id: recipe.finishedProductId },
      select: { marketId: true },
    });

    return client.batchProductAllocation.create({
      data: {
        batchId: batch.id,
        productId: recipe.finishedProductId,
        recipeId: recipe.id,
        marketId: product?.marketId ?? null,
        plannedQuantity: batch.plannedQuantity,
      },
    });
  }

  /**
   * Ajoute une allocation supplémentaire à un batch existant, tant que celui-ci n'a
   * pas atteint le conditionnement. Résout automatiquement le produit (via marché ou
   * directement), la recette active correspondante, vérifie la compatibilité matière
   * première avec la recette de référence du batch, puis écrit l'allocation et
   * incrémente les agrégats du batch — le tout dans une seule transaction.
   */
  async addAllocation(
    siteId: string,
    batchId: string,
    dto: AddBatchProductAllocationInput,
  ): Promise<BatchProductAllocation> {
    if (dto.plannedQuantity <= 0) {
      throw new BadRequestException(
        'La quantité planifiée doit être positive.',
      );
    }
    if (!dto.marketId && !dto.productId) {
      throw new BadRequestException(
        'Précisez un marché ou un produit pour cette allocation.',
      );
    }
    if (dto.marketId && dto.productId) {
      throw new BadRequestException(
        'Précisez soit un marché, soit un produit, jamais les deux.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.batch.findFirst({
        where: { id: batchId, siteId },
      });
      if (!batch) {
        throw new NotFoundException(`Batch ${batchId} introuvable.`);
      }
      this.assertBatchAcceptsNewAllocation(batch);

      const referenceRecipe = await this.loadReferenceRecipe(
        tx,
        siteId,
        batch.recipeId,
      );

      const product = dto.marketId
        ? await this.resolveProductByMarket(
            tx,
            siteId,
            referenceRecipe.finishedProductId,
            dto.marketId,
          )
        : await this.resolveProductDirectly(tx, siteId, dto.productId!);

      const candidateRecipe = await tx.recipe.findFirst({
        where: {
          siteId,
          finishedProductId: product.id,
          format: batch.format,
          status: RecipeStatus.ACTIVE,
        },
        include: {
          lines: { include: { article: { select: { type: true } } } },
        },
      });
      if (!candidateRecipe) {
        throw new BadRequestException(
          `Aucune recette active n'existe pour le produit "${product.name}" au format ${batch.format} ml.`,
        );
      }

      const compatibility = areMaterialFormulasCompatible(
        referenceRecipe,
        candidateRecipe,
      );
      if (!compatibility.compatible) {
        throw new BadRequestException(
          this.describeIncompatibility(compatibility),
        );
      }

      await this.assertNoExistingAllocation(
        tx,
        batchId,
        product.id,
        dto.marketId,
      );

      try {
        const allocation = await tx.batchProductAllocation.create({
          data: {
            batchId,
            productId: product.id,
            recipeId: candidateRecipe.id,
            marketId: dto.marketId ?? null,
            plannedQuantity: dto.plannedQuantity,
          },
        });

        await tx.batch.update({
          where: { id: batchId },
          data: { plannedQuantity: { increment: dto.plannedQuantity } },
        });

        return allocation;
      } catch (error) {
        throw this.toFriendlyConflictError(error);
      }
    });
  }

  /** Allocations d'un batch, scopées par site (via le batch lui-même). */
  async listAllocations(
    siteId: string,
    batchId: string,
  ): Promise<BatchProductAllocation[]> {
    const batch = await this.prisma.batch.findFirst({
      where: { id: batchId, siteId },
    });
    if (!batch) {
      throw new NotFoundException(`Batch ${batchId} introuvable.`);
    }
    return this.prisma.batchProductAllocation.findMany({
      where: { batchId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Autorisé tant que le batch n'a ni terminé ni été annulé, et n'a pas atteint le
   * conditionnement (voir ADR 0006 §7) — les deux conditions sont nécessaires : un
   * batch annulé avant le conditionnement resterait sinon éligible à de nouvelles
   * allocations.
   */
  private assertBatchAcceptsNewAllocation(batch: Batch): void {
    if (
      batch.status !== BatchStatus.PLANIFIE &&
      batch.status !== BatchStatus.EN_COURS
    ) {
      throw new BadRequestException(
        'Impossible d’ajouter une allocation à un batch terminé ou annulé.',
      );
    }
    if (batch.currentStep === BatchStep.CONDITIONNEMENT) {
      throw new BadRequestException(
        'Impossible d’ajouter une allocation une fois le conditionnement atteint.',
      );
    }
  }

  private async loadReferenceRecipe(
    tx: Prisma.TransactionClient,
    siteId: string,
    recipeId: string,
  ): Promise<RecipeWithMaterialLines> {
    const recipe = await tx.recipe.findFirst({
      where: { id: recipeId, siteId },
      include: { lines: { include: { article: { select: { type: true } } } } },
    });
    if (!recipe) {
      throw new NotFoundException(`Recette ${recipeId} introuvable.`);
    }
    return recipe;
  }

  private async resolveProductByMarket(
    tx: Prisma.TransactionClient,
    siteId: string,
    referenceProductId: string,
    marketId: string,
  ): Promise<Article> {
    const referenceProduct = await tx.article.findUnique({
      where: { id: referenceProductId },
      select: { productFamilyId: true },
    });
    if (!referenceProduct?.productFamilyId) {
      throw new BadRequestException(
        'Le produit de référence de ce batch n’appartient à aucune famille commerciale : précisez un produit directement.',
      );
    }

    const market = await tx.market.findFirst({
      where: { id: marketId, siteId },
    });
    if (!market) {
      throw new NotFoundException(`Marché ${marketId} introuvable.`);
    }

    const product = await tx.article.findFirst({
      where: {
        siteId,
        productFamilyId: referenceProduct.productFamilyId,
        marketId,
      },
    });
    if (!product) {
      throw new BadRequestException(
        'Aucun produit n’est décliné pour ce marché dans cette famille commerciale.',
      );
    }
    this.assertProductEligible(product);
    return product;
  }

  private async resolveProductDirectly(
    tx: Prisma.TransactionClient,
    siteId: string,
    productId: string,
  ): Promise<Article> {
    const product = await tx.article.findFirst({
      where: { id: productId, siteId },
    });
    if (!product) {
      throw new NotFoundException(`Produit ${productId} introuvable.`);
    }
    this.assertProductEligible(product);
    if (product.productFamilyId) {
      throw new BadRequestException(
        `Le produit "${product.name}" appartient à une famille commerciale : précisez un marché plutôt qu’un produit.`,
      );
    }
    return product;
  }

  private assertProductEligible(product: Article): void {
    if (product.type !== ArticleType.PRODUIT_FINI) {
      throw new BadRequestException(
        `L'article "${product.name}" n'est pas un produit fini.`,
      );
    }
    if (!product.active) {
      throw new BadRequestException(
        `Le produit "${product.name}" est désactivé.`,
      );
    }
  }

  private async assertNoExistingAllocation(
    tx: Prisma.TransactionClient,
    batchId: string,
    productId: string,
    marketId: string | undefined,
  ): Promise<void> {
    const existingProduct = await tx.batchProductAllocation.findFirst({
      where: { batchId, productId },
    });
    if (existingProduct) {
      throw new ConflictException(
        'Ce produit a déjà une allocation dans ce batch.',
      );
    }
    if (marketId) {
      const existingMarket = await tx.batchProductAllocation.findFirst({
        where: { batchId, marketId },
      });
      if (existingMarket) {
        throw new ConflictException(
          'Ce marché a déjà une allocation dans ce batch.',
        );
      }
    }
  }

  private describeIncompatibility(
    result: Extract<RecipeCompatibilityResult, { compatible: false }>,
  ): string {
    switch (result.reason) {
      case 'FORMAT_MISMATCH':
        return 'Le format de la recette du produit choisi diffère du format du batch.';
      case 'MATERIAL_MISMATCH':
        return `La composition matière première diverge de la recette de référence (article ${result.articleId}).`;
      case 'QUANTITY_MISMATCH':
        return `La quantité par unité de l'article ${result.articleId} diverge de la recette de référence.`;
    }
  }

  /**
   * Distingue les deux contraintes d'unicité posées sur `batch_product_allocations`
   * (voir migration PRD-11) — même principe que
   * `ArticlesService.violatesProductFamilyMarketUniqueness` : avec le driver adapter
   * pg (ADR 0002), le nom de la contrainte violée n'est disponible que dans le
   * message brut Postgres, pas dans `error.meta.target`.
   */
  private toFriendlyConflictError(error: unknown): Error {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const meta = error.meta as
        | { driverAdapterError?: { cause?: { originalMessage?: string } } }
        | undefined;
      const originalMessage = meta?.driverAdapterError?.cause?.originalMessage;
      if (
        typeof originalMessage === 'string' &&
        originalMessage.includes('batch_id_market_id_key')
      ) {
        return new ConflictException(
          'Ce marché a déjà une allocation dans ce batch.',
        );
      }
      if (
        typeof originalMessage === 'string' &&
        originalMessage.includes('batch_id_product_id_key')
      ) {
        return new ConflictException(
          'Ce produit a déjà une allocation dans ce batch.',
        );
      }
      return new ConflictException(
        'Cette allocation entre en conflit avec une allocation déjà existante pour ce batch.',
      );
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}
