# ADR 0002 — Prisma 7 : générateur client CommonJS + driver adapter PostgreSQL

## Statut

Accepté — 2026-07-05

## Contexte

Prisma 7 (utilisé dans LCA-MES) modifie deux comportements par rapport aux versions précédentes de Prisma, non documentés de façon évidente et rencontrés lors de la mise en place du socle :

1. Le nouveau générateur `prisma-client` détecte le format de module à générer (ESM ou CommonJS) en inspectant `compilerOptions.module` du `tsconfig.json` du projet consommateur. Le template Nest 11 utilise `"module": "nodenext"`, qui n'est **pas** reconnu comme `"commonjs"` par cette détection : le client généré par défaut utilisait `import.meta.url`, syntaxe ESM-only, ce qui faisait planter Node au chargement (`ReferenceError: exports is not defined in ES module scope`) puisque Nest exécute en CommonJS.
2. `PrismaClient` n'accepte plus de se connecter à partir d'une simple chaîne `DATABASE_URL` lue implicitement depuis le schéma. Il exige désormais un **driver adapter** explicite (option `adapter` du constructeur), Prisma ayant retiré le moteur de requête natif intégré par défaut au profit d'adaptateurs de pilotes (ex: `@prisma/adapter-pg` pour PostgreSQL).
3. Le client généré référence ses propres fichiers internes avec des imports relatifs à extension `.js` explicite (style ESM/nodenext), même en sortie CommonJS. `ts-node` classique (utilisé par défaut par `prisma db seed`) ne sait pas résoudre ces imports `.js` vers les fichiers `.ts` réels lorsqu'il exécute un script en dehors du pipeline de build de Nest, et échoue avec `Cannot find module './internal/class.js'`.
4. Le moteur de requêtes de Prisma 7 est compilé en WebAssembly et chargé via un `import()` dynamique (`WasmQueryCompilerLoader`). Exécuté sous Jest (ts-jest, environnement CommonJS classique), cet `import()` dynamique échoue avec `TypeError: A dynamic import callback was invoked without --experimental-vm-modules`.

## Décision

1. Dans `prisma/schema.prisma`, le bloc `generator client` fixe explicitement `moduleFormat = "cjs"`, plutôt que de compter sur la détection automatique ou de changer le `tsconfig.json` de Nest (qui reste `nodenext`, un choix délibéré du template Nest 11).
2. `PrismaService` construit `PrismaClient` avec un adapter `@prisma/adapter-pg` (`new PrismaPg(databaseUrl)`), la chaîne de connexion étant lue via `ConfigService.getOrThrow('DATABASE_URL')` (donc validée par le schéma Joi du module `config`).
3. Le script `prisma/seed.ts` est exécuté via **tsx** (et non `ts-node`), configuré dans `prisma.config.ts` (`migrations.seed`). `tsx` (basé sur esbuild) résout correctement ces imports `.js`/`.ts` mixtes, contrairement à `ts-node` classique. Nest lui-même n'est pas concerné : son propre pipeline de build (`nest build`/`nest start --watch`) compile le client généré comme n'importe quel fichier source et fonctionne sans changement.
4. Les configurations Jest (`package.json` pour les tests unitaires, `test/jest-e2e.json` pour les e2e) ajoutent un `moduleNameMapper` (`^(\\.{1,2}/.*)\\.js$` → `$1`) pour que Jest résolve ces imports `.js` vers les fichiers `.ts` correspondants.
5. Les scripts npm `test`, `test:watch`, `test:cov` et `test:e2e` sont exécutés avec `NODE_OPTIONS=--experimental-vm-modules` (via `cross-env`, pour un fonctionnement identique sous Windows et Unix), afin d'autoriser l'`import()` dynamique du moteur WASM à l'intérieur de Jest.

## Alternatives envisagées

- **Changer `tsconfig.json` en `"module": "commonjs"`** : écarté — reviendrait sur un choix par défaut du template Nest 11 sans bénéfice supplémentaire, et n'aurait résolu que le premier problème (le driver adapter reste obligatoire dans tous les cas avec Prisma 7).
- **Migrer l'application entière vers l'ESM** : écarté pour la V0.9 — frictions non justifiées avec l'écosystème Nest/Jest/ts-node actuel pour un gain nul dans ce contexte.
- **Garder `ts-node` pour le seed en ajoutant des options de résolution custom** : écarté — plus fragile et plus complexe à maintenir que d'adopter `tsx`, outil déjà largement utilisé pour ce cas précis.

## Conséquences

- Toute réinitialisation du client (`npx prisma generate`) doit conserver `moduleFormat = "cjs"` dans le schéma : ne pas le supprimer en pensant qu'il s'agit d'un réglage superflu.
- L'ajout d'un nouveau type de datasource (ex: réplique de lecture, base de test dédiée) devra passer par un nouvel adapter/instance `PrismaPg`, pas par une simple variable d'environnement supplémentaire lue automatiquement.
- Tout futur script autonome (hors Nest) qui importe le client Prisma généré doit être exécuté via `tsx`, pas `ts-node`.
- Toute nouvelle configuration Jest ajoutée au projet (ex: pour `packages/shared`) devra reprendre le même `moduleNameMapper` si elle importe, même indirectement, le client Prisma généré.
- Dépendances ajoutées : `@prisma/adapter-pg`, `pg`, `@types/pg`, `tsx`, `cross-env`.
