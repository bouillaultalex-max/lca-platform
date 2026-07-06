/**
 * Données de départ pour un environnement de développement local.
 * Crée le site par défaut et un utilisateur RESPONSABLE_LABORATOIRE si absents.
 * Idempotent : peut être relancé sans dupliquer les données (upsert).
 *
 * ATTENTION : le mot de passe par défaut ci-dessous est destiné au développement
 * uniquement. Il doit être changé avant toute utilisation réelle en production.
 */
import 'dotenv/config';
import * as bcrypt from 'bcryptjs';
import { PrismaPg } from '@prisma/adapter-pg';
import { ArticleType, PrismaClient, RecipeStatus, UserRole } from '../generated/prisma/client';

const DEFAULT_SITE_NAME = 'Laboratoire LCA Distribution';
const DEFAULT_ADMIN_EMAIL = 'responsable@lca-mes.local';
const DEFAULT_ADMIN_PASSWORD = 'ChangezMoi123!';

/**
 * Jeu de données minimal pour développer/tester manuellement le Jalon 2
 * (catalogue, recette, machine) : une matière première, trois packagings,
 * un produit fini, une recette 100 ml et une machine.
 */
const CATALOG_SEED = {
  machine: { name: 'CDA E-Fill 1', supportedFormats: [50, 100, 200] },
  articles: {
    matierePremiere: {
      openSiReference: 'MP-LAVANDE',
      name: 'Parfum ambiance lavande (vrac)',
      unitOfMeasure: 'L',
      currentUnitCost: 12.5,
    },
    flacon: {
      openSiReference: 'PKG-FLA-100',
      name: 'Flacon 100 ml',
      unitOfMeasure: 'unité',
      currentUnitCost: 0.35,
    },
    bouchon: {
      openSiReference: 'PKG-BOU-STD',
      name: 'Bouchon standard',
      unitOfMeasure: 'unité',
      currentUnitCost: 0.1,
    },
    etiquette: {
      openSiReference: 'PKG-ETI-STD',
      name: 'Étiquette standard',
      unitOfMeasure: 'unité',
      currentUnitCost: 0.05,
    },
    produitFini: {
      openSiReference: 'PF-LAV-100',
      name: 'Recharge Lavande 100 ml',
      unitOfMeasure: 'unité',
      currentUnitCost: 0,
    },
  },
} as const;

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL manquant : copier .env.example vers .env avant de lancer le seed.');
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg(databaseUrl) });

  try {
    const site = (await prisma.site.findFirst()) ?? (await prisma.site.create({ data: { name: DEFAULT_SITE_NAME } }));

    const passwordHash = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 12);

    const admin = await prisma.user.upsert({
      where: { email: DEFAULT_ADMIN_EMAIL },
      update: {},
      create: {
        siteId: site.id,
        fullName: 'Responsable Laboratoire',
        email: DEFAULT_ADMIN_EMAIL,
        passwordHash,
        role: UserRole.RESPONSABLE_LABORATOIRE,
      },
    });

    console.log('Site prêt :', site.name);
    console.log('Utilisateur prêt :', admin.email, `(mot de passe par défaut : ${DEFAULT_ADMIN_PASSWORD})`);

    const machine =
      (await prisma.machine.findFirst({ where: { siteId: site.id, name: CATALOG_SEED.machine.name } })) ??
      (await prisma.machine.create({
        data: { siteId: site.id, name: CATALOG_SEED.machine.name, supportedFormats: [...CATALOG_SEED.machine.supportedFormats] },
      }));

    const upsertArticle = (type: ArticleType, data: (typeof CATALOG_SEED.articles)[keyof typeof CATALOG_SEED.articles]) =>
      prisma.article.upsert({
        where: { siteId_openSiReference: { siteId: site.id, openSiReference: data.openSiReference } },
        update: {},
        create: { siteId: site.id, type, ...data },
      });

    const matierePremiere = await upsertArticle(ArticleType.MATIERE_PREMIERE, CATALOG_SEED.articles.matierePremiere);
    const flacon = await upsertArticle(ArticleType.PACKAGING, CATALOG_SEED.articles.flacon);
    const bouchon = await upsertArticle(ArticleType.PACKAGING, CATALOG_SEED.articles.bouchon);
    const etiquette = await upsertArticle(ArticleType.PACKAGING, CATALOG_SEED.articles.etiquette);
    const produitFini = await upsertArticle(ArticleType.PRODUIT_FINI, CATALOG_SEED.articles.produitFini);

    const recipe = await prisma.recipe.upsert({
      where: { finishedProductId_format_version: { finishedProductId: produitFini.id, format: 100, version: 1 } },
      update: {},
      create: {
        siteId: site.id,
        finishedProductId: produitFini.id,
        format: 100,
        version: 1,
        status: RecipeStatus.ACTIVE,
        lines: {
          create: [
            { articleId: matierePremiere.id, quantityPerUnit: 0.1, unit: 'L' },
            { articleId: flacon.id, quantityPerUnit: 1, unit: 'unité' },
            { articleId: bouchon.id, quantityPerUnit: 1, unit: 'unité' },
            { articleId: etiquette.id, quantityPerUnit: 1, unit: 'unité' },
          ],
        },
      },
    });

    console.log('Machine prête :', machine.name);
    console.log('Recette prête :', produitFini.name, `format ${recipe.format} ml (v${recipe.version})`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('Échec du seed :', error);
  process.exitCode = 1;
});
