# PROJECT_STATE — État du projet LCA-MES

Document de suivi vivant, à mettre à jour à la fin de chaque jalon. Contrairement aux autres documents de `docs/` (qui décrivent l'architecture cible), celui-ci décrit **l'état réel du dépôt aujourd'hui**.

Dernière mise à jour : **2026-07-07** — **Jalon 2 officiellement terminé** : `catalog`, `stock`, `batching`, `production` et `import-export` (backend + écran frontend Imports) sont tous terminés, backend et frontend, vérifiés en navigateur.

## 1. Statut

| Jalon | Statut |
|---|---|
| Jalon 0 — Cadrage & documentation | ✅ Terminé |
| Jalon 1 — Socle technique | ✅ Terminé et vérifié (tests, build, navigateur) |
| Jalon 2 — Cœur production (catalogue, stock, batching, production, lots, imports) | ✅ **Terminé** — `catalog` ✅, `stock` ✅, `batching` ✅, `production` ✅, `import-export` ✅ (backend + frontend) |
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

**Modules Nest existants** : `auth`, `prisma`, `config`, `common/column-mapping` (moteur générique de mapping de colonnes, voir ADR 0003), `catalog` (`articles`, `machines`, `recipes`), `stock` (`stock-lots`, `stock-items`, `stock-movements`, `stock-fifo`), `batching` (`batches`, `batch-preparation`), `production` (`batch-steps`, `batch-stops`, `batch-closure`, `lot-number-generator`), `import-export` (`import-logs`, `import-parser`, `mapping-configs`, `articles-import`, `stocks-import`, `expected-requirements-import`, `inventory-import`).

**Modèle Prisma existant** (12 migrations) : `Site`, `User`, `AuditLog`, `Article` (avec `unitsPerCarton`, `densityKgPerL`), `Machine`, `Recipe`, `RecipeLine`, `StockLot`, `StockItem`, `StockMovement`, `Batch` (avec `currentStep` séparé de `status`), `BatchStop`, `Lot`, `LotGenealogy`, `ImportLog` (avec `errorDetails` JSON), `ExportLog`, `ExpectedRequirement`, `ColumnMappingRule` (avec `sourceVersion`). **Tous les modèles liés à `import-export` sont désormais réellement exploités** : `ImportLog` par les 4 imports (créé à la prévisualisation, mis à jour à la confirmation), `ExpectedRequirement` en écriture par l'import Besoins attendus (append-only), `ColumnMappingRule` par le moteur de mapping (apprentissage des corrections). Seul `ExportLog` reste sans logique applicative (exports vers OpenSi, Jalon 4).

**Frontend existant** : `/login`, `/dashboard`, `/catalog` (liste/création d'articles, filtre par type, désactivation), `/catalog/recipes` (versionnement, archivage auto, règle des 100 % matières premières), `/stock` (écran maître-détail : recherche, filtre, équivalent cartons, indicateur stock faible, réception, ajustement avec aperçu de l'écart, historique par lot), `/production` (écran maître-détail : création de batch avec aperçu volume + masse et alerte densité manquante, frise des 4 étapes de production, gestion des arrêts, clôture avec numéro de lot affiché après clôture), `/imports` (assistant en 5 étapes — type, fichier, colonnes, aperçu, confirmation — pour les 4 imports OpenSi ; onglet Historique filtrable ; bandeau "dernier import" ; vocabulaire volontairement sans jargon technique).

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
npm run test:api                     # unitaires (apps/api) — 218 tests
npm run test:api:e2e                 # e2e — nécessite la base lca_mes_test + apps/api/.env.test — 35 tests
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

### Jalon 2 — Phase E (import-export, backend)
- **Dépendances sécurisées** : `xlsx` installé depuis le CDN officiel SheetJS (0.20.3, la version npm publique reste vulnérable) ; `multer` porté à 2.2.0 via `overrides` npm (2 CVE connues corrigées).
- **Moteur générique de mapping de colonnes** (`common/column-mapping/`, voir ADR 0003) : détection automatique par synonymes (correspondance exacte/partielle/orthographique, seuil 50/100), apprentissage persistant des corrections manuelles (`ColumnMappingRule`, scopé par site + source + **version de connecteur** + type d'entité), aucune connaissance métier dans le moteur — les synonymes et champs attendus vivent dans des fichiers de configuration séparés (`import-export/mapping-configs/`). Conçu pour être réutilisé par de futurs connecteurs (Magento, CRM...), pas seulement OpenSi.
- **Import Articles** : upsert par `openSiReference` ; ne touche jamais `active`/`unitsPerCarton`/`densityKgPerL` (champs propres à LCA-MES) ; `type` immuable (tentative de changement = erreur de ligne explicite, jamais silencieusement ignorée) ; doublon intra-fichier = erreur bloquante.
- **Import Stocks** : réutilise `StockLotsService.receive()` sans dupliquer sa logique — ce service a été étendu pour accepter un client Prisma transactionnel optionnel (même principe que `LotNumberGeneratorService`), permettant une **atomicité totale** de l'import (toutes les réceptions + mise à jour du journal en une seule transaction). Article désactivé référencé = erreur bloquante. Doublon (article + lot fournisseur), qu'il soit intra-fichier ou contre l'existant, = avertissement seulement (jamais bloquant), ligne incluse par défaut. Dates acceptées sous 3 formats explicites (série Excel, ISO, français), sans bibliothèque tierce.
- **Import Besoins attendus** : historique **append-only** — chaque ligne valide crée toujours un nouvel `ExpectedRequirement`, jamais de mise à jour ; aucune détection de doublon (une même référence peut légitimement apparaître plusieurs fois) ; `importedAt` absent → un seul instant de confirmation appliqué à tout le lot ; aucune restriction de type d'article (tranchée plus tard, au moment de l'écran de planification).
- **Import Inventaire** : **volontairement partiel**, en l'absence d'un fichier réel OpenSi observé. Prévisualisation uniquement (parse + mapping + détection structurelle "avec ou sans lot fournisseur"), aucune validation de contenu de ligne. `confirm()` renvoie systématiquement `501 Not Implemented` avec un message explicite — aucune stratégie de réconciliation n'est codée en dur.
- **Toutes les prévisualisations créent systématiquement un `ImportLog`** (même abandonnées ensuite) ; toutes les confirmations **revalident intégralement côté serveur** depuis l'état actuel de la base, sans jamais faire confiance à ce que le frontend a mémorisé de la prévisualisation.
- **Rôles** : les 4 écrans d'import sont fermés à `DIRECTION`/`DAF`, comme `catalog`/`batching`/`production`.

### Jalon 2 — Phase F (écran frontend Imports) — clôture du Jalon 2
- **Assistant en 5 étapes** (`/imports`, `apps/web/src/pages/imports/`) : Type → Fichier → Colonnes → Aperçu → Confirmation, plus un onglet Historique séparé. Dépôt de fichier = envoi immédiat de la prévisualisation (pas de bouton "envoyer" séparé).
- **Vocabulaire volontairement sans jargon** : "Colonnes reconnues / à vérifier / non utilisées" (jamais "mapping", "correspondance", "confiance", "score") ; explications textuelles (`describeRecognizedField`) plutôt qu'un score de confiance affiché.
- **Tableau de bord visuel** (grandes cartes colorées : créations, mises à jour, réceptions, besoins importés, avertissements, erreurs), **encart de réassurance** avant confirmation ("Vous êtes sur le point d'enregistrer... 0 suppression"), **véritable écran de réussite** après confirmation (pas un simple bandeau).
- **Bandeau "dernier import"** : construit uniquement à partir de `GET /import-export/logs` déjà existant, sans aucun endpoint supplémentaire.
- Un panneau d'aperçu dédié par type d'import (pas de composant générique unique) — Inventaire sans case à cocher ni bouton de confirmation, conforme à sa nature "aperçu uniquement" (E13-E14).
- **Bug réel corrigé, trouvé uniquement grâce à la vérification navigateur** : `PreviewImportDto.mappingCorrections` (champ multipart JSON sérialisé) combinait `@Transform` et `@Type()` sur la même propriété — les corrections de mapping étaient systématiquement rejetées par le `ValidationPipe({ whitelist: true })` réel (`400 : property fieldKey should not exist`), un défaut qu'aucun test unitaire ne pouvait détecter puisqu'il ne passe jamais par le pipe de validation. Corrigé via `plainToInstance` directement dans le `@Transform`. Un test e2e de régression a été ajouté (`import-export.e2e-spec.ts`) pour verrouiller ce comportement.
- **Le Jalon 2 est officiellement terminé** à l'issue de cette phase.

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
15. **Moteur de mapping des connecteurs générique et versionné** (ADR 0003) : détection automatique + apprentissage persistant, réutilisable par tout futur connecteur (pas seulement OpenSi), jamais de connaissance métier dans le moteur lui-même.
16. **`type` d'article immuable via import**, comme via l'écran manuel — une incohérence de type entre le fichier et l'existant est une erreur de ligne, jamais une mise à jour silencieuse.
17. **Doublon (article + lot fournisseur) en import Stocks = avertissement, pas une erreur** — contrairement au doublon de référence en import Articles, qui reste bloquant.
18. **`StockLotsService.receive()` accepte un client Prisma transactionnel optionnel**, pour une atomicité totale des imports de masse (et de tout futur traitement similaire), sans dupliquer sa logique.
19. **Import Besoins attendus append-only** : aucune mise à jour possible, aucune détection de doublon — chaque ligne est un fait historique indépendant.
20. **Import Inventaire volontairement partiel** : prévisualisation et détection structurelle uniquement, `confirm()` renvoie `501 Not Implemented` tant qu'un fichier réel OpenSi n'a pas été analysé.

**Actées le 2026-07-07** :
21. **Écran Imports sans jargon technique** : "colonnes reconnues/à vérifier/non utilisées", jamais "mapping"/"correspondance"/"confiance"/"score" — le logiciel doit donner l'impression de comprendre naturellement le fichier.
22. **Tableau de bord visuel, encart de réassurance et écran de réussite** dédiés dans l'assistant d'import — objectif : qu'un responsable comprenne le résultat d'un import en moins de 5 secondes.
23. **Le Jalon 2 est officiellement clôturé** : `catalog`, `stock`, `batching`, `production`, `import-export` sont tous terminés (backend + frontend, vérifiés en navigateur).

## 8. Points encore ouverts (à trancher pendant le Jalon 2/3, non bloquants pour continuer)

- Algorithme exact de génération du numéro de lot (format confirmé, détail à fournir par l'utilisateur) — bloquant pour finaliser `LotNumberGeneratorService` (actuellement un placeholder `455XXX` séquentiel).
- Formule exacte de `besoinCalculé`/`quantitéSuggérée` pour les besoins attendus, et leur déclinaison **par gamme** (regroupement de produits) — l'import qui alimente l'historique est terminé, mais l'écran de planification qui exploitera cette donnée n'est pas construit.
- Notion de "gamme" (regroupement de produits) : n'existe toujours pas dans le modèle (`Article` n'a pas de champ famille/catégorie) — à préciser lors de la conception du futur écran de planification.
- **Stratégie de réconciliation de l'import Inventaire** : non tranchée par choix — en attente d'un fichier réel OpenSi pour savoir si la granularité est par lot fournisseur ou par quantité globale par article. L'architecture (mapping + détection structurelle) est prête à accueillir les deux cas ; `confirm()` renvoie `501 Not Implemented` tant que la décision n'est pas prise.
- Règle exacte de calcul du statut qualité global du lot à partir des contrôles individuels (Jalon 3).
- **Consultation du numéro de lot après rechargement d'un batch terminé** : actuellement affiché uniquement juste après la clôture (réponse de l'API), pas rechargeable ensuite (aucun endpoint de lecture des `Lot` pour l'instant). Noté explicitement par l'utilisateur pour traitement lors du futur module `traceability` (Jalon 3).
- Docker/`docker-compose.yml` écrits et raisonnés mais jamais exécutés avec un vrai Docker (non disponible dans l'environnement de développement utilisé).
- Vulnérabilités npm résiduelles, toutes pré-existantes et sans rapport avec `import-export` (chaîne `@hono/node-server`/`@prisma/dev`/`prisma`, 3 alertes modérées) — `xlsx` et `multer` ont été corrigés pendant la Phase E.

## 9. Prochaine étape

**Le Jalon 2 est entièrement terminé** (backend et frontend, tous modules). Le Jalon 3 (traçabilité, qualité, coûts) n'a pas encore démarré et sera cadré avec l'utilisateur avant tout code, comme pour chaque jalon précédent — aucun développement du Jalon 3 n'est anticipé ou codé par avance.
