/**
 * Données de départ pour l'environnement DÉMONSTRATION/TEST DAF (`lca_mes_demo`).
 *
 * Distinct de `seed.ts` (données de développement local sur `lca_mes_dev`, jamais
 * modifié par ce fichier) : celui-ci cible exclusivement `lca_mes_demo`, un
 * environnement totalement indépendant, destiné à être testé librement puis
 * réinitialisé (voir `reset-demo.ts`) sans jamais toucher aux données réelles.
 *
 * Idempotent (upsert) : peut être relancé sans dupliquer les données ni écraser
 * une progression déjà faite par le DAF (ex. un `LotNumberCounter` déjà avancé
 * n'est jamais remis à sa valeur initiale par un second lancement — seul
 * `reset-demo.ts`, qui recrée la base de zéro, garantit un retour à l'état vierge).
 *
 * Utilisation (voir docs/demo-environment.md) :
 *   DATABASE_URL="postgresql://lca_mes:<mdp>@localhost:5432/lca_mes_demo?schema=public" npx tsx prisma/seed-demo.ts
 *
 * Ne jamais lancer sans surcharger DATABASE_URL explicitement — voir demo-database-guard.ts.
 */
import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';
import * as bcrypt from 'bcryptjs';
import { PrismaPg } from '@prisma/adapter-pg';
import { ArticleType, PrismaClient, RecipeStatus, UserRole } from '../generated/prisma/client';
import { assertTargetsDemoDatabase, DEMO_DATABASE_NAME } from './demo-database-guard';

// Charge .env.demo (jamais .env générique — voir test/setup-env.ts pour le même
// principe appliqué à .env.test) : DATABASE_URL y pointe déjà exclusivement vers
// lca_mes_demo, donc même un lancement sans surcharge explicite reste sûr. dotenv
// n'écrase jamais une variable déjà présente dans l'environnement (voir README) :
// un DATABASE_URL passé explicitement en ligne de commande reste toujours prioritaire.
loadDotenv({ path: resolve(__dirname, '../.env.demo') });

const DEMO_SITE_NAME = 'Laboratoire LCA Distribution';

/**
 * Mot de passe de démonstration unique, volontairement simple et documenté
 * (voir docs/demo-environment.md) — jamais un mot de passe réel, jamais
 * recopié d'un compte existant sur lca_mes_dev.
 */
const DEMO_PASSWORD = 'DemoLCA2026!';

const DEMO_USERS: Array<{
  email: string;
  fullName: string;
  role: UserRole;
  isSystemAdmin: boolean;
}> = [
  {
    email: 'responsable.demo@lca-mes.local',
    fullName: 'Démo — Responsable Laboratoire',
    role: UserRole.RESPONSABLE_LABORATOIRE,
    // Droits d'administration (gestion des utilisateurs) pour pouvoir gérer
    // librement l'environnement demo sans dépendre de ce script pour tout.
    isSystemAdmin: true,
  },
  {
    email: 'adjoint.demo@lca-mes.local',
    fullName: 'Démo — Responsable Adjoint',
    role: UserRole.RESPONSABLE_ADJOINT,
    isSystemAdmin: false,
  },
  {
    email: 'direction.demo@lca-mes.local',
    fullName: 'Démo — Direction',
    role: UserRole.DIRECTION,
    isSystemAdmin: false,
  },
  {
    email: 'daf.demo@lca-mes.local',
    fullName: 'Démo — DAF',
    role: UserRole.DAF,
    isSystemAdmin: false,
  },
];

const DEMO_MACHINE = { name: 'DEMO — Machine de conditionnement', supportedFormats: [50, 100, 200] };

/**
 * Deux matières premières (unité réelle obligatoire), deux packagings et un
 * produit fini (unité forcée à "unité" — voir ArticlesService.resolveUnitOfMeasure
 * et l'évolution "unité conditionnelle au type" déjà implémentée). Noms préfixés
 * "DEMO —" pour rester sans ambiguïté avec toute donnée réelle.
 */
const DEMO_ARTICLES = {
  materialVanille: {
    openSiReference: 'DEMO-MP-VANILLE',
    name: 'DEMO — Parfum Vanille (vrac)',
    unitOfMeasure: 'L',
    currentUnitCost: 9.5,
  },
  materialVg: {
    openSiReference: 'DEMO-MP-VG',
    name: 'DEMO — Glycérine végétale (VG)',
    unitOfMeasure: 'L',
    currentUnitCost: 3.2,
  },
  packagingFlacon: {
    openSiReference: 'DEMO-PKG-FLACON',
    // unitOfMeasure forcée à "unité" ci-dessous, jamais demandée/affichée en
    // fiche article pour ce type — voir périmètre "unité conditionnelle au type".
    name: 'DEMO — Flacon 100 ml',
    unitOfMeasure: 'unité',
    currentUnitCost: 0.35,
  },
  packagingBouchon: {
    openSiReference: 'DEMO-PKG-BOUCHON',
    name: 'DEMO — Bouchon standard',
    unitOfMeasure: 'unité',
    currentUnitCost: 0.1,
  },
  finishedProduct: {
    openSiReference: 'DEMO-PF-VANILLE',
    name: 'DEMO — Recharge Vanille 100 ml',
    unitOfMeasure: 'unité',
    currentUnitCost: 0,
  },
} as const;

/** Stock généreux (voir docs/demo-environment.md) : permet plusieurs cycles
 * complets de lancement/clôture entre deux réinitialisations, sans épuisement
 * prématuré pendant les tests du DAF. */
const DEMO_STOCK = {
  materialVanilleLiters: 200,
  materialVgLiters: 200,
  packagingFlaconUnits: 5000,
  packagingBouchonUnits: 5000,
};

/**
 * Recette 100 ml : 60 % Vanille + 40 % VG (matière première commune du batch,
 * voir ADR 0006/0010), 1 flacon + 1 bouchon par unité produite (packaging).
 * Composition volontairement simple mais complète : permet de démontrer le
 * calcul d'ingrédients, la faisabilité, la consommation de stock à la clôture
 * et la généalogie de traçabilité pour chaque matière/packaging.
 */
const DEMO_RECIPE_FORMAT = 100;

/**
 * Valeur d'amorçage du compteur de numérotation de lot (ADR 0010 § Décision 7) :
 * cette base est strictement vierge, aucun `Lot` historique n'existe ni n'existera
 * jamais avant le premier lancement de batch — l'invariant `lastIssuedNumber >=
 * MAX(lotNumber numérique existant)` est donc TOUJOURS satisfait quelle que soit
 * la valeur choisie (§ Décision 7, cas "aucun Lot pour le site"). 100000 est une
 * valeur purement conventionnelle propre à cet environnement de démonstration —
 * elle ne représente aucune donnée réelle du laboratoire et ne doit JAMAIS être
 * confondue avec 455002/456148 (numérotation réelle, utilisée uniquement sur
 * lca_mes_dev). Le premier lot créé sur cette base portera le numéro 100001.
 */
const DEMO_LOT_NUMBER_COUNTER_START = 100000;

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const databaseName = assertTargetsDemoDatabase(databaseUrl);
  console.log(`Base ciblée (vérifiée) : "${databaseName}" — conforme, poursuite du seed.`);

  const prisma = new PrismaClient({ adapter: new PrismaPg(databaseUrl!) });

  try {
    const site =
      (await prisma.site.findFirst({ where: { name: DEMO_SITE_NAME } })) ??
      (await prisma.site.create({ data: { name: DEMO_SITE_NAME } }));
    console.log(`Site prêt : ${site.name} (${site.id})`);

    for (const user of DEMO_USERS) {
      const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
      await prisma.user.upsert({
        where: { email: user.email },
        update: {},
        create: {
          siteId: site.id,
          fullName: user.fullName,
          email: user.email,
          passwordHash,
          role: user.role,
          isSystemAdmin: user.isSystemAdmin,
          mustChangePassword: false,
        },
      });
      console.log(`Utilisateur prêt : ${user.email} (${user.role}) — mot de passe : ${DEMO_PASSWORD}`);
    }

    const machine =
      (await prisma.machine.findFirst({ where: { siteId: site.id, name: DEMO_MACHINE.name } })) ??
      (await prisma.machine.create({
        data: { siteId: site.id, name: DEMO_MACHINE.name, supportedFormats: [...DEMO_MACHINE.supportedFormats] },
      }));
    console.log(`Machine prête : ${machine.name}`);

    const upsertArticle = (
      type: ArticleType,
      data: (typeof DEMO_ARTICLES)[keyof typeof DEMO_ARTICLES],
    ) =>
      prisma.article.upsert({
        where: { siteId_openSiReference: { siteId: site.id, openSiReference: data.openSiReference } },
        update: {},
        create: { siteId: site.id, type, ...data },
      });

    const materialVanille = await upsertArticle(ArticleType.MATIERE_PREMIERE, DEMO_ARTICLES.materialVanille);
    const materialVg = await upsertArticle(ArticleType.MATIERE_PREMIERE, DEMO_ARTICLES.materialVg);
    const packagingFlacon = await upsertArticle(ArticleType.PACKAGING, DEMO_ARTICLES.packagingFlacon);
    const packagingBouchon = await upsertArticle(ArticleType.PACKAGING, DEMO_ARTICLES.packagingBouchon);
    const finishedProduct = await upsertArticle(ArticleType.PRODUIT_FINI, DEMO_ARTICLES.finishedProduct);
    console.log('Articles prêts : 2 matières premières, 2 packagings, 1 produit fini.');

    // Stock : StockLot (lot de réception FIFO) + StockItem (quantité disponible
    // agrégée) — mêmes deux écritures que StockLotsService.receive(), reproduites
    // ici en écriture directe (ce script suit le même principe que seed.ts/
    // bootstrap-admin.ts : hors du cycle de vie HTTP/NestJS, jamais un contournement
    // d'une règle métier réelle — la réception de stock n'a pas de règle de
    // validation au-delà de l'existence de l'article et d'une quantité positive).
    async function provisionStock(articleId: string, quantity: number, supplierLotNumber: string) {
      const existingItem = await prisma.stockItem.findUnique({ where: { articleId } });
      if (existingItem && Number(existingItem.availableQuantity) > 0) {
        // Déjà provisionné par un lancement précédent de ce script — ne jamais
        // dupliquer le stock à chaque relance (idempotence).
        return;
      }
      await prisma.stockLot.create({
        data: {
          siteId: site.id,
          articleId,
          supplierLotNumber,
          receivedQuantity: quantity,
          remainingQuantity: quantity,
          receivedAt: new Date(),
        },
      });
      await prisma.stockItem.upsert({
        where: { articleId },
        update: { availableQuantity: { increment: quantity } },
        create: { siteId: site.id, articleId, availableQuantity: quantity },
      });
    }

    await provisionStock(materialVanille.id, DEMO_STOCK.materialVanilleLiters, 'DEMO-LOT-VANILLE-001');
    await provisionStock(materialVg.id, DEMO_STOCK.materialVgLiters, 'DEMO-LOT-VG-001');
    await provisionStock(packagingFlacon.id, DEMO_STOCK.packagingFlaconUnits, 'DEMO-LOT-FLACON-001');
    await provisionStock(packagingBouchon.id, DEMO_STOCK.packagingBouchonUnits, 'DEMO-LOT-BOUCHON-001');
    console.log('Stock provisionné pour les 2 matières premières et les 2 packagings.');

    const recipe = await prisma.recipe.upsert({
      where: {
        finishedProductId_format_version: {
          finishedProductId: finishedProduct.id,
          format: DEMO_RECIPE_FORMAT,
          version: 1,
        },
      },
      update: {},
      create: {
        siteId: site.id,
        finishedProductId: finishedProduct.id,
        format: DEMO_RECIPE_FORMAT,
        version: 1,
        status: RecipeStatus.ACTIVE,
        lines: {
          create: [
            { articleId: materialVanille.id, quantityPerUnit: 60, unit: '%' },
            { articleId: materialVg.id, quantityPerUnit: 40, unit: '%' },
            { articleId: packagingFlacon.id, quantityPerUnit: 1, unit: 'unité' },
            { articleId: packagingBouchon.id, quantityPerUnit: 1, unit: 'unité' },
          ],
        },
      },
    });
    console.log(`Recette prête : ${finishedProduct.name}, format ${recipe.format} ml (v${recipe.version}).`);

    await prisma.lotNumberCounter.upsert({
      where: { siteId: site.id },
      // Ne JAMAIS réinitialiser un compteur déjà amorcé par un lancement
      // précédent de ce script (idempotence — voir en-tête de fichier).
      update: {},
      create: {
        siteId: site.id,
        lastIssuedNumber: DEMO_LOT_NUMBER_COUNTER_START,
        lastIssuedBatchId: null,
        lastIssuedAvailableForReuse: false,
      },
    });
    console.log(
      `Compteur de numérotation prêt : prochain numéro = ${DEMO_LOT_NUMBER_COUNTER_START + 1} ` +
        `(valeur conventionnelle demo, sans rapport avec la numérotation réelle du laboratoire).`,
    );

    console.log('');
    console.log(`✅ Environnement "${DEMO_DATABASE_NAME}" prêt à l'emploi.`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error('Échec du seed demo :', error);
    process.exitCode = 1;
  });
}
