import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ArticlesService } from './articles.service';
import { PrismaService } from '../../prisma/prisma.service';
import { Article, ArticleType, Prisma } from '../../../generated/prisma/client';

describe('ArticlesService', () => {
  let service: ArticlesService;
  let prisma: {
    article: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    supplier: {
      findFirst: jest.Mock;
    };
  };

  const siteId = 'site-1';

  const article: Article = {
    id: 'article-1',
    siteId,
    type: ArticleType.MATIERE_PREMIERE,
    openSiReference: 'MP-LAVANDE',
    name: 'Parfum ambiance lavande (vrac)',
    unitOfMeasure: 'L',
    currentUnitCost: new Prisma.Decimal(12.5),
    unitsPerCarton: null,
    densityKgPerL: null,
    supplierId: null,
    active: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
  };

  beforeEach(async () => {
    prisma = {
      article: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      supplier: {
        findFirst: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ArticlesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(ArticlesService);
  });

  describe('findAll', () => {
    it('filtre par site et par type quand un type est fourni', async () => {
      prisma.article.findMany.mockResolvedValue([article]);

      const result = await service.findAll(
        siteId,
        ArticleType.MATIERE_PREMIERE,
      );

      expect(prisma.article.findMany).toHaveBeenCalledWith({
        where: { siteId, type: ArticleType.MATIERE_PREMIERE },
        orderBy: { name: 'asc' },
      });
      expect(result).toEqual([article]);
    });

    it('ne filtre que par site quand aucun type n’est fourni', async () => {
      prisma.article.findMany.mockResolvedValue([article]);

      await service.findAll(siteId);

      expect(prisma.article.findMany).toHaveBeenCalledWith({
        where: { siteId },
        orderBy: { name: 'asc' },
      });
    });
  });

  describe('findOne', () => {
    it('retourne l’article s’il existe sur ce site', async () => {
      prisma.article.findFirst.mockResolvedValue(article);

      const result = await service.findOne(siteId, article.id);

      expect(result).toEqual(article);
    });

    it('lève NotFoundException si l’article est introuvable sur ce site', async () => {
      prisma.article.findFirst.mockResolvedValue(null);

      await expect(service.findOne(siteId, 'inconnu')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('crée l’article rattaché au site courant', async () => {
      prisma.article.create.mockResolvedValue(article);

      const dto = {
        type: ArticleType.MATIERE_PREMIERE,
        openSiReference: 'MP-LAVANDE',
        name: 'Parfum ambiance lavande (vrac)',
        unitOfMeasure: 'L',
        currentUnitCost: 12.5,
      };

      const result = await service.create(siteId, dto);

      expect(prisma.article.create).toHaveBeenCalledWith({
        data: { siteId, ...dto },
      });
      expect(result).toEqual(article);
    });

    it('convertit une violation d’unicité (référence OpenSi déjà utilisée) en ConflictException', async () => {
      prisma.article.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '7.8.0',
        }),
      );

      await expect(
        service.create(siteId, {
          type: ArticleType.MATIERE_PREMIERE,
          openSiReference: 'MP-LAVANDE',
          name: 'Doublon',
          unitOfMeasure: 'L',
          currentUnitCost: 1,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('crée une matière première avec un fournisseur principal valide', async () => {
      prisma.supplier.findFirst.mockResolvedValue({ id: 'supplier-1', siteId });
      prisma.article.create.mockResolvedValue({
        ...article,
        supplierId: 'supplier-1',
      });

      const dto = {
        type: ArticleType.MATIERE_PREMIERE,
        openSiReference: 'MP-LAVANDE',
        name: 'Parfum ambiance lavande (vrac)',
        unitOfMeasure: 'L',
        currentUnitCost: 12.5,
        supplierId: 'supplier-1',
      };

      const result = await service.create(siteId, dto);

      expect(prisma.supplier.findFirst).toHaveBeenCalledWith({
        where: { id: 'supplier-1', siteId },
      });
      expect(result.supplierId).toBe('supplier-1');
    });

    it('crée un packaging avec un fournisseur principal valide (retour Kevin : commandes de packaging)', async () => {
      prisma.supplier.findFirst.mockResolvedValue({ id: 'supplier-1', siteId });
      prisma.article.create.mockResolvedValue({
        ...article,
        type: ArticleType.PACKAGING,
        supplierId: 'supplier-1',
      });

      const dto = {
        type: ArticleType.PACKAGING,
        openSiReference: 'PKG-1',
        name: 'Bouchon',
        unitOfMeasure: 'unité',
        currentUnitCost: 0.1,
        supplierId: 'supplier-1',
      };

      const result = await service.create(siteId, dto);

      expect(prisma.supplier.findFirst).toHaveBeenCalledWith({
        where: { id: 'supplier-1', siteId },
      });
      expect(result.supplierId).toBe('supplier-1');
    });

    it('refuse un fournisseur principal sur un article de type produit fini', async () => {
      await expect(
        service.create(siteId, {
          type: ArticleType.PRODUIT_FINI,
          openSiReference: 'PF-1',
          name: 'Flacon fini',
          unitOfMeasure: 'unité',
          currentUnitCost: 3,
          supplierId: 'supplier-1',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.article.create).not.toHaveBeenCalled();
    });

    it('refuse un fournisseur principal introuvable sur ce site', async () => {
      prisma.supplier.findFirst.mockResolvedValue(null);

      await expect(
        service.create(siteId, {
          type: ArticleType.MATIERE_PREMIERE,
          openSiReference: 'MP-LAVANDE',
          name: 'Parfum ambiance lavande (vrac)',
          unitOfMeasure: 'L',
          currentUnitCost: 12.5,
          supplierId: 'inconnu',
        }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.article.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    const zeroUsage = {
      _count: {
        recipeLines: 0,
        recipesAsFinishedProduct: 0,
        stockLots: 0,
        stockMovements: 0,
        genealogyLines: 0,
      },
    };

    it('modifie un article sans vérifier l’usage si le type n’est pas fourni', async () => {
      prisma.article.findFirst.mockResolvedValue(article);
      prisma.article.update.mockResolvedValue({
        ...article,
        name: 'Nouveau nom',
      });

      const result = await service.update(siteId, article.id, {
        name: 'Nouveau nom',
      });

      expect(prisma.article.findUnique).not.toHaveBeenCalled();
      expect(result.name).toBe('Nouveau nom');
    });

    it('modifie un article sans vérifier l’usage si le type fourni est identique à l’existant', async () => {
      prisma.article.findFirst.mockResolvedValue(article);
      prisma.article.update.mockResolvedValue(article);

      await service.update(siteId, article.id, {
        type: article.type,
        name: article.name,
      });

      expect(prisma.article.findUnique).not.toHaveBeenCalled();
    });

    it('autorise le changement de type si l’article n’a jamais été utilisé', async () => {
      prisma.article.findFirst.mockResolvedValue(article);
      prisma.article.findUnique.mockResolvedValue(zeroUsage);
      prisma.article.update.mockResolvedValue({
        ...article,
        type: ArticleType.PACKAGING,
      });

      const result = await service.update(siteId, article.id, {
        type: ArticleType.PACKAGING,
      });

      expect(result.type).toBe(ArticleType.PACKAGING);
    });

    it.each([
      ['recipeLines', { ...zeroUsage._count, recipeLines: 1 }],
      [
        'recipesAsFinishedProduct',
        { ...zeroUsage._count, recipesAsFinishedProduct: 1 },
      ],
      ['stockLots', { ...zeroUsage._count, stockLots: 1 }],
      ['stockMovements', { ...zeroUsage._count, stockMovements: 1 }],
      ['genealogyLines', { ...zeroUsage._count, genealogyLines: 1 }],
    ])('refuse le changement de type si %s > 0', async (_label, counts) => {
      prisma.article.findFirst.mockResolvedValue(article);
      prisma.article.findUnique.mockResolvedValue({ _count: counts });

      await expect(
        service.update(siteId, article.id, { type: ArticleType.PACKAGING }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.article.update).not.toHaveBeenCalled();
    });

    it('lève NotFoundException si l’article à modifier n’existe pas sur ce site', async () => {
      prisma.article.findFirst.mockResolvedValue(null);

      await expect(
        service.update(siteId, 'inconnu', { name: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('valide le fournisseur principal quand supplierId est fourni', async () => {
      prisma.article.findFirst.mockResolvedValue(article);
      prisma.supplier.findFirst.mockResolvedValue({ id: 'supplier-1', siteId });
      prisma.article.update.mockResolvedValue({
        ...article,
        supplierId: 'supplier-1',
      });

      const result = await service.update(siteId, article.id, {
        supplierId: 'supplier-1',
      });

      expect(prisma.supplier.findFirst).toHaveBeenCalledWith({
        where: { id: 'supplier-1', siteId },
      });
      expect(result.supplierId).toBe('supplier-1');
    });

    it('autorise l’assignation d’un fournisseur lors d’un changement de type vers PACKAGING', async () => {
      prisma.article.findFirst.mockResolvedValue(article);
      prisma.article.findUnique.mockResolvedValue(zeroUsage);
      prisma.supplier.findFirst.mockResolvedValue({ id: 'supplier-1', siteId });
      prisma.article.update.mockResolvedValue({
        ...article,
        type: ArticleType.PACKAGING,
        supplierId: 'supplier-1',
      });

      const result = await service.update(siteId, article.id, {
        type: ArticleType.PACKAGING,
        supplierId: 'supplier-1',
      });

      expect(result.supplierId).toBe('supplier-1');
    });

    it('refuse d’assigner un fournisseur si le type résolu est un produit fini', async () => {
      prisma.article.findFirst.mockResolvedValue(article);
      prisma.article.findUnique.mockResolvedValue(zeroUsage);

      await expect(
        service.update(siteId, article.id, {
          type: ArticleType.PRODUIT_FINI,
          supplierId: 'supplier-1',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.article.update).not.toHaveBeenCalled();
    });

    it('n’efface pas le fournisseur principal si le type change vers PACKAGING', async () => {
      const mpWithSupplier = { ...article, supplierId: 'supplier-1' };
      prisma.article.findFirst.mockResolvedValue(mpWithSupplier);
      prisma.article.findUnique.mockResolvedValue(zeroUsage);
      prisma.article.update.mockResolvedValue({
        ...mpWithSupplier,
        type: ArticleType.PACKAGING,
      });

      await service.update(siteId, article.id, {
        type: ArticleType.PACKAGING,
      });

      expect(prisma.article.update).toHaveBeenCalledWith({
        where: { id: article.id },
        data: { type: ArticleType.PACKAGING },
      });
    });

    it('efface automatiquement le fournisseur principal si le type change vers PRODUIT_FINI', async () => {
      const mpWithSupplier = { ...article, supplierId: 'supplier-1' };
      prisma.article.findFirst.mockResolvedValue(mpWithSupplier);
      prisma.article.findUnique.mockResolvedValue(zeroUsage);
      prisma.article.update.mockResolvedValue({
        ...mpWithSupplier,
        type: ArticleType.PRODUIT_FINI,
        supplierId: null,
      });

      await service.update(siteId, article.id, {
        type: ArticleType.PRODUIT_FINI,
      });

      expect(prisma.article.update).toHaveBeenCalledWith({
        where: { id: article.id },
        data: { type: ArticleType.PRODUIT_FINI, supplierId: null },
      });
    });
  });

  describe('deactivate', () => {
    it('désactive l’article (active: false) sans le supprimer', async () => {
      prisma.article.findFirst.mockResolvedValue(article);
      prisma.article.update.mockResolvedValue({ ...article, active: false });

      const result = await service.deactivate(siteId, article.id);

      expect(prisma.article.update).toHaveBeenCalledWith({
        where: { id: article.id },
        data: { active: false },
      });
      expect(result.active).toBe(false);
    });

    it('lève NotFoundException si l’article à désactiver n’existe pas sur ce site', async () => {
      prisma.article.findFirst.mockResolvedValue(null);

      await expect(service.deactivate(siteId, 'inconnu')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
