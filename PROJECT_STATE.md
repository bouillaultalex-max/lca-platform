# PROJECT_STATE — État du projet LCA-MES

Document de suivi vivant, à mettre à jour à la fin de chaque jalon. Contrairement aux autres documents de `docs/` (qui décrivent l'architecture cible), celui-ci décrit **l'état réel du dépôt aujourd'hui**.

Dernière mise à jour : **2026-07-06** — Jalon 2 en cours : modules `catalog`, `stock`, `batching` et `production` terminés (backend + frontend, vérifiés en navigateur) ; `import-export` reste à faire.

## 1. Statut

| Jalon | Statut |
|---|---|
| Jalon 0 — Cadrage & documentation | ✅ Terminé |
| Jalon 1 — Socle technique | ✅ Terminé et vérifié (tests, build, navigateur) |
| Jalon 2 — Cœur production (catalogue, stock, batching, production, lots) | ⏳ En cours — `catalog` ✅, `stock` ✅, `batching` ✅, `production` ✅ ; `import-export` à venir |
| Jalon 3 — Traçabilité, qualité, coûts | Non démarré |
| Jalon 4 — Exports, tableaux de bord, sauvegardes | Non démarré |

## 2. Ce qui existe dans le dépôt

```
lca-mes/
├── apps/
│   ├── api/     # NestJS — auth, catalog, stock, batching, production, Prisma, Swagger, ServeStatic
│   └── web/     # React + Vite + Tailwind — login, tableau de bord, catalogue, recettes, stock, production
├── packages/
│   └── shared/  # Types partagés (UserRole, auth, catalog, stock, production)
├── docs/                 # architecture, modèle de données, règles métier, roadmap, ADR
├── docker-compose.yml, apps/api/Dockerfile   # déploiement (optionnel, non testé avec Docker réel)
├── CLAUDE.md, MASTER_SPECIFICATION.md, README.md
└── PROJECT_STATE.md       # ce fichier
```

**Modules Nest existants** : `auth`, `prisma`, `config`, `catalog` (`articles`, `machines`, `recipes`), `stock` (`stock-lots`, `stock-items`, `stock-movements`, `stock-fifo`), `batching` (`batches`, `batch-preparation`), `production` (`batch-steps`, `batch-stops`, `batch-closure`, `lot-number-generator`).

**Modèle Prisma existant** (9 migrations) : `Site`, `User`, `AuditLog`, `Article` (avec `unitsPerCarton`, `densityKgPerL`), `Machine`, `Recipe`, `RecipeLine`, `StockLot`, `StockItem`, `StockMovement`, `Batch` (avec `currentStep` séparé de `status`), `BatchStop`, `Lot`, `LotGenealogy`, `ImportLog`, `ExportLog`, `ExpectedRequirement`. **Attention** : `Lot`/`LotGenealogy` sont désormais réellement exploités (génération à la clôture d'un batch) ; seuls `ImportLog`/`ExportLog`/`ExpectedRequirement` restent sans logique applicative (module `import-export` pas encore développé).

**Frontend existant** : `/login`, `/dashboard`, `/catalog` (liste/création d'articles, filtre par type, désactivation), `/catalog/recipes` (versionnement, archivage auto, règle des 100 % matières premières), `/stock` (écran maître-détail : recherche, filtre, équivalent cartons, indicateur stock faible, réception, ajustement avec aperçu de l'écart, historique par lot), `/production` (écran maître-détail : création de batch avec aperçu volume + masse et alerte densité manquante, frise des 4 étapes de production, gestion des arrêts, clôture avec numéro de lot affiché après clôture).

## 3. Commandes utiles

### Développement local (sans Docker)
```bash
npm install                          # à la racine, une fois
npm run dev:api                      # API sur http://localhost:3000 (Swagger: /api/docs)
npm run dev:web                      # Frontend sur http://localhost:5173
```

### Base de données
```bash
npm run prisma:migrate               # applique les migrations sur lca_mes_dev
npm run prisma:seed                  # (re)crée le site, l'utilisateur par défaut, une machine et une recette de démo
```

### Tests
```bash
npm run test:api                     # unitaires (apps/api) — 115 tests
npm run test:api:e2e                 # e2e — nécessite la base lca_mes_test + apps/api/.env.test — 31 tests
```

### Build / lint
```bash
npm run build:api
npm run build:web
npm run lint:api                     # eslint
cd apps/web && npm run lint          # oxlint
```

### Déploiement (optionnel)
```bash
cp .env.example .env                 # POSTGRES_PASSWORD, JWT_SECRET
docker compose up -d --build
```

## 4. Bases de données locales

| Base | Rôle | Usage |
|---|---|---|
| `lca_mes_dev` | `lca_mes` | Développement local (`apps/api/.env`) |
| `lca_mes_test` | `lca_mes` | Tests e2e uniquement (`apps/api/.env.test`) — **les migrations doivent y être appliquées séparément** (`prisma migrate deploy` avec les variables de `.env.test`), sinon les tests e2e échouent silencieusement sur un schéma obsolète (rencontré une fois pendant la Phase C, corrigé). |

## 5. Comptes de test

| Email | Mot de passe | Rôle | Contexte |
|---|---|---|---|
| `responsable@lca-mes.local` | `ChangezMoi123!` | `RESPONSABLE_LABORATOIRE` | Créé par `npm run prisma:seed` (base `lca_mes_dev`) — **développement uniquement, à changer avant tout usage réel.** Le seed crée aussi une machine ("CDA E-Fill 1") et une recette de démo ("Recharge Lavande 100 ml", v1) pour disposer de données de test réalistes. |

## 6. Décisions techniques prises

### Jalon 1 (socle)
- Monolithe modulaire NestJS + React/Vite/Tailwind + PostgreSQL + Prisma, sans Docker requis en développement (voir `docs/adr/0001-architecture-v09.md`).
- Prisma 7 nécessite des ajustements non standards (générateur `moduleFormat = "cjs"`, driver adapter `@prisma/adapter-pg`, `tsx` pour le seed, `NODE_OPTIONS=--experimental-vm-modules` pour Jest) — détaillés dans `docs/adr/0002-prisma7-driver-adapter-pg.md`. Toute nouvelle table Prisma doit passer par `npm run prisma:migrate`, jamais par une modification manuelle du schéma en base.
- Guards d'authentification globaux (`JwtAuthGuard` + `RolesGuard`) : tout nouvel endpoint est **protégé par défaut**. Utiliser `@Public()` pour un endpoint public, `@Roles(...)` pour restreindre par rôle — l'absence de `@Roles(...)` autorise tout utilisateur authentifié (utilisé délibérément pour les lectures du module `stock`, ouvertes à `DIRECTION`/`DAF`).
- `ServeStaticModule` déjà configuré pour servir le build React en production ; chaque nouveau préfixe d'API (`/auth`, `/catalog`, `/stock`...) doit être ajouté à son `exclude` **et** au proxy Vite (`apps/web/vite.config.ts`), sinon les routes sont masquées par le repli SPA en développement.

### Jalon 2 — Phases A à C (catalogue, stock)
- **Suppression = désactivation partout**, jamais de suppression physique (`Article`, `Machine`, `Recipe` archivée) — préserve l'historique (recettes, stock, coûts figés).
- **Recette** : toute création avec un produit fini + format déjà actif archive automatiquement l'ancienne version et incrémente la version, dans une transaction Prisma. Aucun endpoint de modification des lignes d'une recette existante : c'est la seule garantie que l'immutabilité est respectée.
- **Article désactivé** : bloqué à la création d'une recette (comme matière première/packaging ou comme produit fini) ; **autorisé en revanche à la réception de stock** (on peut recevoir physiquement une référence arrêtée ou restante).
- **Conditionnement en carton** (`Article.unitsPerCarton`, `Int` optionnel) : calcul d'affichage uniquement, le stock reste compté en unités. Valeur libre par article, non figée en dur (pas de table de correspondance format→carton) — décisions actées le 2026-07-06, voir `docs/roadmap.md`.
- **FIFO confirmé** (premier lot reçu, premier consommé) pour la sélection des `StockLot` — service interne (`StockFifoService`) sans endpoint public, en attente d'un consommateur (module `production`, Jalon 2 suite). Évolution FEFO (basée sur péremption) envisagée plus tard, non implémentée.
- **Ajustement d'inventaire** : cible toujours un `StockLot` précis (jamais un ajustement global par article), pour préserver l'invariant `StockItem.availableQuantity = Σ StockLot.remainingQuantity`. Toujours journalisé en `StockMovement`, même à écart nul (traçabilité d'une vérification sans écart).
- **Seuil de stock minimum** (`StockItem.minimumThreshold`) : source unique de vérité (pas de duplication dans `ExpectedRequirement`) ; `isLowStock` calculé côté serveur, jamais dupliqué côté frontend.
- **Rôles module par module** : `catalog` est fermé à `DIRECTION`/`DAF` (ni lecture ni écriture) ; `stock` leur ouvre la lecture (conforme à `docs/regles-metier.md` §1) mais leur ferme l'écriture.

### Jalon 2 — Phase D (batching, production)
- **`BatchStep` séparé de `BatchStatus`** : le statut (`PLANIFIE`/`EN_COURS`/`TERMINE`/`ANNULE`) indique l'état global du batch, l'étape (`PREPARATION`/`MELANGE`/`INCORPORATION_TREMIE`/`CONDITIONNEMENT`, champ `Batch.currentStep`) indique où on en est dans le workflow réel. Seule l'étape courante est stockée en V0.9 (pas d'horodatage détaillé par étape).
- **Progression stricte, aucun retour en arrière** : un seul endpoint fait avancer à l'étape suivante ; aucun endpoint ne permet de revenir en arrière.
- **Densité (`Article.densityKgPerL`)** : optionnelle, matières premières uniquement, aucune valeur par défaut codée en dur — sert uniquement au calcul de la masse à peser en préparation de batch (`BatchPreparationService`), n'est **pas** utilisée pour la déduction de stock (qui reste en volume, L).
- **Refactor `StockFifoService`** : logique FIFO extraite en fonction pure `computeFifoAllocations()`, réutilisable à l'intérieur d'une transaction Prisma (clôture de batch) sans dupliquer l'algorithme. Non-régression vérifiée.
- **`LotNumberGeneratorService`** : implémentation placeholder `455001`, `455002`... (compteur séquentiel par site) — **temporaire**, à remplacer par l'algorithme réel une fois fourni (voir `docs/regles-metier.md` §4).
- **Clôture de batch atomique** : génération du `Lot`, de la `LotGenealogy` (une ligne par `StockLot` consommé, pas par article), déduction `StockLot`/`StockItem`, création des `StockMovement` `SORTIE_BATCH`, et passage du `Batch` à `TERMINE` — le tout dans une seule transaction Prisma. Rupture de stock = rejet global agrégé (tous les articles manquants listés), aucune écriture partielle.
- **Rôles** : `batching` et `production` sont fermés à `DIRECTION`/`DAF` (comme `catalog`), pas seulement en écriture.

## 7. Décisions métier confirmées

Voir `docs/regles-metier.md` pour le détail complet.

**Actées le 2026-07-05** :
1. Les rebuts consomment le packaging en plus de la matière première.
2. Le coût par flacon se calcule sur la quantité totale produite, rebuts inclus.
3. Numéro de lot : convention 6 chiffres commençant par 455 (`455XXX`), algorithme exact non encore fourni ; génération isolée dans `LotNumberGeneratorService` (pas encore codé).
4. Contrôle qualité multi-type dès la V0.9.
5. Traçabilité amont : stock suivi par `StockLot`.
6. Besoins attendus : quantités pour maintenir le stock de sécurité (import brut uniquement, pas de formule de suggestion pour l'instant).

**Actées le 2026-07-06** :
7. **Conditionnement en cartons** : flacons 10/30/50/100 ml → cartons de 100 ; flacons 200 ml → cartons de 36. Affichage uniquement (voir §6 ci-dessus).
8. **FIFO confirmé** comme règle par défaut d'affectation des `StockLot`.
9. **Ajustement d'inventaire** toujours ciblé sur un `StockLot` précis.
10. **Nouveau module futur `logistique`** (expédition, conditionnement, exports transporteurs) et **module futur `r&d`** (recettes expérimentales, essais, validation, promotion vers le catalogue production) — anticipés pour une version post-V0.9, non codés.
11. **Workflow réel de préparation/batching/production** (voir `docs/regles-metier.md` §12) : consultation des besoins → adaptation des quantités par gamme (objectif ~1 mois ou plus de couverture) → préparation de la recette selon la quantité à produire (aujourd'hui via Excel, à remplacer par un calcul automatique dans `batching`) → batching → mélange → incorporation en trémie → conditionnement machine. Le module `production` doit distinguer ces 4 dernières étapes (préparation/batching, mélange, incorporation trémie, conditionnement) plutôt qu'un statut unique "en cours". **Aucune étape de maturation** dans le processus réel — à ne pas prévoir en V0.9.
12. **`BatchStep` séparé de `BatchStatus`**, une seule étape courante stockée (pas d'historique horodaté par étape en V0.9) — voir §6 ci-dessus.
13. **Déduction de stock des matières premières en volume (L)**, jamais en masse — la densité/masse reste un indicateur de pesée pour la préparation.
14. **Rôles `batching`/`production`** : fermés à `DIRECTION`/`DAF`, comme `catalog`.

## 8. Points encore ouverts (à trancher pendant le Jalon 2/3, non bloquants pour continuer)

- Algorithme exact de génération du numéro de lot (format confirmé, détail à fournir par l'utilisateur) — bloquant pour finaliser `LotNumberGeneratorService` (actuellement un placeholder `455XXX` séquentiel).
- Formule exacte de `besoinCalculé`/`quantitéSuggérée` pour les besoins attendus, et désormais leur déclinaison **par gamme** (regroupement de produits) — module `import-export`, pas encore développé.
- Notion de "gamme" (regroupement de produits) : n'existe pas encore dans le modèle (`Article` n'a pas de champ famille/catégorie) — à préciser lors de la conception du module `import-export`/besoins attendus.
- Règle exacte de calcul du statut qualité global du lot à partir des contrôles individuels (Jalon 3).
- **Consultation du numéro de lot après rechargement d'un batch terminé** : actuellement affiché uniquement juste après la clôture (réponse de l'API), pas rechargeable ensuite (aucun endpoint de lecture des `Lot` pour l'instant). Noté explicitement par l'utilisateur pour traitement lors du futur module `traceability` (Jalon 3).
- Docker/`docker-compose.yml` écrits et raisonnés mais jamais exécutés avec un vrai Docker (non disponible dans l'environnement de développement utilisé).
- Vulnérabilités npm connues et non corrigées (transitives : `multer` via `@nestjs/platform-express`) — à traiter sérieusement dès que `multer` sera réellement exercé par l'upload de fichiers d'import (module `import-export`, pas encore développé).

## 9. Prochaine étape

Reste du Jalon 2 : module `import-export` (imports OpenSi — articles, références, stocks, besoins attendus, inventaire — avec prévisualisation obligatoire). Découpage détaillé à proposer et valider avant tout développement, comme pour les phases précédentes. Le Jalon 3 (traçabilité, qualité, coûts) ne démarre pas avant la fin du Jalon 2.
