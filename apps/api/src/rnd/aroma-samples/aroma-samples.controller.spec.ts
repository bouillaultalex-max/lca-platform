import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { AromaSamplesController } from './aroma-samples.controller';
import {
  AromaSamplesService,
  PaginatedAromaSamples,
} from './aroma-samples.service';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma, UserRole } from '../../../generated/prisma/client';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user';
import {
  AromaSampleSortBy,
  AromaSampleSortOrder,
  QueryAromaSamplesDto,
} from './dto/query-aroma-samples.dto';

/**
 * Vérifie `AromaSamplesController` (routage) et `AromaSamplesService` (filtrage,
 * pagination, tri) dans le même fichier, comme demandé pour RD-01D-1. Le contrôleur
 * est testé avec un service mocké (même patron que
 * `aroma-samples-import.controller.spec.ts` — appeler les méthodes directement ne
 * traverse pas les guards globaux, testés séparément dans `roles.guard.spec.ts`, d'où
 * l'absence de test de rôle ici, comme dans tous les contrôleurs existants du projet).
 * Le service est testé avec `PrismaService` mocké (même patron que
 * `aroma-samples-import.service.spec.ts`), sans vraie base ni vrai Prisma.
 */
describe('AromaSamplesController', () => {
  let controller: AromaSamplesController;
  let service: { findAll: jest.Mock };

  const user: AuthenticatedUser = {
    id: 'user-1',
    siteId: 'site-1',
    fullName: 'Alex Bouillault',
    email: 'alex@example.test',
    role: UserRole.RESPONSABLE_ADJOINT,
    jobTitle: null,
    isSystemAdmin: false,
    mustChangePassword: false,
    lastLoginAt: null,
  };

  const emptyResult: PaginatedAromaSamples = {
    items: [],
    meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
  };

  beforeEach(async () => {
    service = { findAll: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AromaSamplesController],
      providers: [{ provide: AromaSamplesService, useValue: service }],
    }).compile();

    controller = module.get(AromaSamplesController);
  });

  it('appelle AromaSamplesService.findAll avec le siteId et la query reçue', async () => {
    service.findAll.mockResolvedValue(emptyResult);
    const query = new QueryAromaSamplesDto();

    const result = await controller.findAll(user, query);

    expect(service.findAll).toHaveBeenCalledTimes(1);
    expect(service.findAll).toHaveBeenCalledWith('site-1', query);
    // Aucune transformation métier : le contrôleur retourne exactement ce que le
    // service a renvoyé.
    expect(result).toBe(emptyResult);
  });

  it('prend siteId depuis le contexte utilisateur authentifié, jamais de la query', async () => {
    service.findAll.mockResolvedValue(emptyResult);

    await controller.findAll(user, new QueryAromaSamplesDto());

    const [siteIdArg] = service.findAll.mock.calls[0] as [string];
    expect(siteIdArg).toBe(user.siteId);
  });

  it('ignore tout siteId éventuellement présent dans la query : `QueryAromaSamplesDto` ne déclare pas ce champ et seul `@CurrentUser()` détermine le site', async () => {
    service.findAll.mockResolvedValue(emptyResult);
    // Simule une tentative d'injection de siteId côté client (bypass du DTO réel,
    // qui n'a pas cette propriété — en conditions réelles, `ValidationPipe({
    // whitelist: true, forbidNonWhitelisted: true })` rejetterait la requête avant
    // même d'atteindre ce contrôleur).
    const maliciousQuery = {
      ...new QueryAromaSamplesDto(),
      siteId: 'site-attaquant',
    } as unknown as QueryAromaSamplesDto;

    await controller.findAll(user, maliciousQuery);

    const [siteIdArg] = service.findAll.mock.calls[0] as [string];
    expect(siteIdArg).toBe('site-1');
    expect(siteIdArg).not.toBe('site-attaquant');
  });

  it('propage sans la modifier une erreur levée par le service', async () => {
    const error = new BadRequestException('Erreur de test.');
    service.findAll.mockRejectedValue(error);

    await expect(
      controller.findAll(user, new QueryAromaSamplesDto()),
    ).rejects.toBe(error);
  });
});

describe('AromaSamplesService', () => {
  let service: AromaSamplesService;
  let prisma: {
    rndAromaSample: {
      findMany: jest.Mock<Promise<unknown[]>, [unknown]>;
      count: jest.Mock<Promise<number>, [unknown]>;
    };
  };

  const siteId = 'site-1';

  const sampleRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'sample-1',
    legacyId: 'EF-001',
    supplierNameRaw: 'Fournisseur X',
    productName: 'Vanille Bourbon',
    supplierReference: 'REF-001',
    category: 'Vanille',
    rating: new Prisma.Decimal(4),
    stockGrams: new Prisma.Decimal(250),
    pricePerKgEur: new Prisma.Decimal(89.5),
    addedAt: new Date('2026-07-06T00:00:00.000Z'),
    comment: 'Commentaire',
    active: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  });

  beforeEach(async () => {
    prisma = {
      rndAromaSample: {
        findMany: jest
          .fn<Promise<unknown[]>, [unknown]>()
          .mockResolvedValue([]),
        count: jest.fn<Promise<number>, [unknown]>().mockResolvedValue(0),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AromaSamplesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(AromaSamplesService);
  });

  function findManyArgs(): {
    where: Record<string, unknown>;
    orderBy: Record<string, string>;
    skip: number;
    take: number;
  } {
    return prisma.rndAromaSample.findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
      orderBy: Record<string, string>;
      skip: number;
      take: number;
    };
  }

  it('filtre toujours par siteId, même sans autre critère', async () => {
    await service.findAll(siteId, new QueryAromaSamplesDto());

    expect(findManyArgs().where).toEqual({ siteId });
    const countArgs = prisma.rndAromaSample.count.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(countArgs.where).toEqual({ siteId });
  });

  it('recherche sur productName parmi les critères de recherche globale (OR)', async () => {
    const query = new QueryAromaSamplesDto();
    query.search = 'Vanille';

    await service.findAll(siteId, query);

    const where = findManyArgs().where as { OR?: unknown[] };
    expect(where.OR).toContainEqual({
      productName: { contains: 'Vanille', mode: 'insensitive' },
    });
  });

  it('recherche sur le fournisseur (supplierNameRaw) parmi les critères de recherche globale (OR)', async () => {
    const query = new QueryAromaSamplesDto();
    query.search = 'Fournisseur X';

    await service.findAll(siteId, query);

    const where = findManyArgs().where as { OR?: unknown[] };
    expect(where.OR).toEqual(
      expect.arrayContaining([
        {
          supplierNameRaw: { contains: 'Fournisseur X', mode: 'insensitive' },
        },
        {
          supplierReference: {
            contains: 'Fournisseur X',
            mode: 'insensitive',
          },
        },
        { legacyId: { contains: 'Fournisseur X', mode: 'insensitive' } },
      ]),
    );
  });

  it('filtre exactement par catégorie', async () => {
    const query = new QueryAromaSamplesDto();
    query.category = 'Vanille';

    await service.findAll(siteId, query);

    expect(findManyArgs().where.category).toBe('Vanille');
  });

  it('filtre exactement par statut actif/inactif (y compris `false`, jamais confondu avec "absent")', async () => {
    const query = new QueryAromaSamplesDto();
    query.active = false;

    await service.findAll(siteId, query);

    expect(findManyArgs().where.active).toBe(false);
  });

  it('applique la pagination (skip/take) à partir de page et limit', async () => {
    const query = new QueryAromaSamplesDto();
    query.page = 3;
    query.limit = 10;

    await service.findAll(siteId, query);

    const args = findManyArgs();
    expect(args.skip).toBe(20);
    expect(args.take).toBe(10);
  });

  it('utilise page=1 et une limite par défaut raisonnable en l’absence de pagination explicite', async () => {
    await service.findAll(siteId, new QueryAromaSamplesDto());

    const args = findManyArgs();
    expect(args.skip).toBe(0);
    expect(args.take).toBeGreaterThan(0);
  });

  it('calcule meta.totalPages à partir du total réel et de la limite demandée', async () => {
    prisma.rndAromaSample.count.mockResolvedValue(45);
    const query = new QueryAromaSamplesDto();
    query.limit = 20;

    const result = await service.findAll(siteId, query);

    expect(result.meta).toEqual({
      page: 1,
      limit: 20,
      total: 45,
      totalPages: 3,
    });
  });

  it.each([
    [AromaSampleSortBy.PRODUCT_NAME, 'productName'],
    [AromaSampleSortBy.SUPPLIER_NAME_RAW, 'supplierNameRaw'],
    [AromaSampleSortBy.ADDED_AT, 'addedAt'],
    [AromaSampleSortBy.CREATED_AT, 'createdAt'],
  ])('trie par %s (ordre demandé respecté)', async (sortBy, field) => {
    const query = new QueryAromaSamplesDto();
    query.sortBy = sortBy;
    query.sortOrder = AromaSampleSortOrder.ASC;

    await service.findAll(siteId, query);

    expect(findManyArgs().orderBy).toEqual({ [field]: 'asc' });
  });

  it('retombe sur createdAt desc par défaut sans sortBy ni sortOrder', async () => {
    await service.findAll(siteId, new QueryAromaSamplesDto());

    expect(findManyArgs().orderBy).toEqual({ createdAt: 'desc' });
  });

  it('n’inclut jamais de donnée d’un autre site : where.siteId correspond exactement au siteId demandé', async () => {
    const query = new QueryAromaSamplesDto();

    await service.findAll('site-A', query);
    await service.findAll('site-B', query);

    const firstArgs = prisma.rndAromaSample.findMany.mock.calls[0][0] as {
      where: { siteId: string };
    };
    const secondArgs = prisma.rndAromaSample.findMany.mock.calls[1][0] as {
      where: { siteId: string };
    };
    expect(firstArgs.where.siteId).toBe('site-A');
    expect(secondArgs.where.siteId).toBe('site-B');
  });

  it('convertit les décimaux Prisma en nombres simples et gère les valeurs nulles', async () => {
    prisma.rndAromaSample.findMany.mockResolvedValue([
      sampleRow(),
      sampleRow({
        id: 'sample-2',
        legacyId: 'EF-002',
        rating: null,
        stockGrams: null,
        pricePerKgEur: null,
        addedAt: null,
        supplierReference: null,
        comment: null,
      }),
    ]);
    prisma.rndAromaSample.count.mockResolvedValue(2);

    const result = await service.findAll(siteId, new QueryAromaSamplesDto());

    expect(result.items[0]).toMatchObject({
      id: 'sample-1',
      rating: 4,
      stockGrams: 250,
      pricePerKgEur: 89.5,
    });
    expect(result.items[1]).toMatchObject({
      id: 'sample-2',
      rating: null,
      stockGrams: null,
      pricePerKgEur: null,
      addedAt: null,
      supplierReference: null,
      comment: null,
    });
    // Champs internes jamais exposés par l'API de consultation.
    expect(result.items[0]).not.toHaveProperty('importLogId');
    expect(result.items[0]).not.toHaveProperty('linkedArticleId');
    expect(result.items[0]).not.toHaveProperty('siteId');
  });
});
