# PRD-11 — Plan de développement : Allocation multi-produits

Plan technique final, produit après revue d'architecture (voir `revue-architecture.md`, `decisions-metier.md` et `docs/adr/0006-allocation-marche-batch.md`, tous révisés et figés le 2026-07-17). Aucun code ni schéma Prisma n'a été modifié à ce stade — ce document prépare intégralement le développement.

## Principe directeur retenu

Un batch représente un run physique unique autour d'un seul mélange commun. Il produit une ou plusieurs sorties commerciales (`BatchProductAllocation`) ; le mélange (matière première) est calculé une seule fois pour tout le batch, le packaging est dérivé automatiquement de la recette de chaque allocation. Tout nouveau batch possède au moins une allocation — un seul chemin de traitement dans tous les services concernés.

## Ordre recommandé

Étapes 1 → 4 : préalable strict. 2, 3, 4 peuvent être menées en parallèle une fois 1 terminée. 5 dépend de 4 ; 6 dépend de 5 ; 7 et 8 dépendent de 5/6 ; 9 dépend de 8 ; **10 reste le jalon central** (dépend de 1, 5, 7) et doit être traité avec le plus grand soin, sans parallélisation. 11 démarre dès l'étape 1 (recherche) mais se conclut après 10. Le frontend (12-15) ne démarre sérieusement qu'une fois le contrat API stabilisé (après 6 pour la création, après 10 pour la clôture). 16 et 17 ferment la feature.

---

### Étape 1 — Migration Prisma complète

- **Objectif** : ajouter `Market`, `ProductFamily`, les champs `Article.productFamilyId`/`marketId` (avec contrainte d'unicité `(productFamilyId, marketId)`), `BatchProductAllocation` (`batchId`, `productId`, `recipeId`, `marketId` nullable, `plannedQuantity`, `producedQuantity`, `rejectedQuantity`, unique `(batchId, productId)` et `(batchId, marketId)` quand non nul), `Lot.allocationId` (nullable, FK `BatchProductAllocation`), retrait de la contrainte `@unique` sur `Lot.batchId`, `StockMovement.batchProductAllocationId` (nullable).
- **Fichiers** : `apps/api/prisma/schema.prisma`, nouvelle migration générée (`npm run prisma:migrate`).
- **Dépendances** : aucune.
- **Risques** : **élevé** — retirer l'unicité sur `Lot.batchId` change une contrainte d'intégrité déjà en production ; à ne valider qu'après recensement complet (étape 11). Faire une seule migration groupée plutôt que plusieurs petites, pour éviter un état intermédiaire incohérent (une `BatchProductAllocation` sans `Lot.allocationId` disponible ne sert à rien).
- **Tests** : migration appliquée sur une base contenant des batchs/lots existants → vérifier qu'ils restent lisibles (`allocationId = null`, `batchId` inchangé, aucune `BatchProductAllocation` créée rétroactivement) ; test des nouvelles contraintes d'unicité.
- **Estimation** : moyenne.

### Étape 2 — Module `catalog/markets`

- **Objectif** : référentiel simple (code, libellé, actif), calqué sur `SuppliersService`/`SuppliersController`.
- **Fichiers** : `apps/api/src/catalog/markets/*` (nouveau module), `catalog.module.ts`.
- **Dépendances** : étape 1.
- **Risques** : faibles (pattern déjà éprouvé deux fois — Machines, Suppliers).
- **Tests** : unitaires service (create/update/deactivate), e2e CRUD minimal.
- **Estimation** : petite.

### Étape 3 — Module `catalog/product-families` + validation `ArticlesService`

- **Objectif** : référentiel `ProductFamily` (CRUD simple, même pattern). Extension d'`ArticlesService` : validation `marketId` ne peut être renseigné que si `productFamilyId` l'est aussi ; endpoint ou paramètre pour associer un article existant (`PRODUIT_FINI`) à une famille + un marché, avec la contrainte d'unicité `(productFamilyId, marketId)` remontée en erreur explicite si violée.
- **Fichiers** : `apps/api/src/catalog/product-families/*` (nouveau module), `apps/api/src/catalog/articles/articles.service.ts` (+ `.spec.ts`), `dto/update-article.dto.ts`.
- **Dépendances** : étape 1.
- **Risques** : moyens — s'assurer que l'effacement automatique déjà existant (fournisseur effacé si l'article devient `PRODUIT_FINI`, voir V0.3) a un équivalent cohérent ici : que se passe-t-il si un article membre d'une famille change de type ou est désactivé ? Recommandation à documenter dans le service (ex. désactivation autorisée, changement de type bloqué si déjà utilisé dans une allocation — même garde-fou que la règle déjà existante sur `recipeLines`/`stockLots`/etc.).
- **Tests** : unitaires — association valide, marché dupliqué dans la même famille rejeté, `marketId` sans `productFamilyId` rejeté.
- **Estimation** : petite.

### Étape 4 — Fonction pure de compatibilité matière première

- **Objectif** : `areMaterialFormulasCompatible(recipeA, recipeB)` — compare les lignes de type `MATIERE_PREMIERE` (articleId + quantité par unité) et le format des deux recettes ; retourne un résultat structuré (compatible/non, détail des divergences pour le message d'erreur).
- **Fichiers** : nouveau `apps/api/src/catalog/recipes/recipe-compatibility.ts` (+ `.spec.ts`) — fonction pure dans le domaine catalogue, pas un service à part entière (pas d'injection Nest nécessaire).
- **Dépendances** : étape 1 (aucune, en réalité — logique pure sur des `Recipe`/`RecipeLine` déjà existants ; classée ici pour l'ordonnancement).
- **Risques** : faibles — attention à la précision `Decimal` (comparaison d'égalité stricte, pas de tolérance flottante) et à l'ordre des lignes (comparaison par ensemble, pas par position).
- **Tests** : unitaires — recettes identiques, recette avec un article en plus/en moins, quantité légèrement différente, format différent, recette sans aucune ligne matière première.
- **Estimation** : petite.

### Étape 5 — `BatchProductAllocationsService` : création et ajout d'allocations

- **Objectif** : nouveau service portant la logique de résolution automatique et les invariants transactionnels :
  - `createInitialAllocation(tx, batch, dto)` — appelée depuis la création du batch (étape 6), crée la première allocation à partir de la recette choisie (produit dérivé de `recipe.finishedProductId`, marché dérivé de `product.marketId` si la famille existe) ;
  - `addAllocation(siteId, batchId, { marketId } | { productId }, plannedQuantity)` — résout le produit/la recette (via famille+marché ou produit direct), vérifie les invariants 4/5/6 (format, compatibilité matière première, cohérence produit/recette), vérifie que `currentStep !== CONDITIONNEMENT`, écrit l'allocation et met à jour `Batch.plannedQuantity` dans la même transaction ;
  - `listAllocations(siteId, batchId)` — lecture.
- **Fichiers** : nouveau `apps/api/src/batching/batch-product-allocations/*` (service, controller, DTOs).
- **Dépendances** : étapes 1, 3, 4.
- **Risques** : **élevé** — c'est le point de couture central des invariants métier ; toute erreur ici se répercute silencieusement sur la clôture (étape 10). Bien couvrir le cas "aucune recette active pour ce produit à ce format" (message explicite, pas une erreur technique).
- **Tests** : unitaires — ajout via marché (résolution automatique correcte), ajout via produit direct (hors famille), marché/produit dupliqué rejeté, recette incompatible rejetée avec message explicite, ajout après conditionnement rejeté, invariant de somme vérifié après ajout.
- **Estimation** : moyenne.

### Étape 6 — `BatchesService.create` : création systématique de la première allocation

- **Objectif** : le DTO de création de batch **ne change pas** (`recipeId`, `machineId`, `plannedQuantity`). Le service crée, dans la même transaction que le `Batch`, sa première `BatchProductAllocation` via `BatchProductAllocationsService.createInitialAllocation`.
- **Fichiers** : `apps/api/src/batching/batches/batches.service.ts` (+ `.spec.ts`).
- **Dépendances** : étape 5.
- **Risques** : moyens — s'assurer que la création du `Batch` et celle de sa première allocation sont bien atomiques (une transaction unique, pas deux écritures séparées).
- **Tests** : unitaires — création standard (vérifier qu'une allocation unique est bien créée, avec le bon `productId`/`recipeId`/`marketId` le cas échéant), non-régression complète du comportement actuel (recette archivée rejetée, machine incompatible rejetée).
- **Estimation** : petite à moyenne.

### Étape 7 — Ajustement des appelants de `BatchPreparationService`

- **Objectif** : `computeIngredientQuantities()` ne change pas de forme. Ajuster les appelants (`BatchFeasibilityService`, `BatchClosureService`, `BatchesController.computePreparation`) pour filtrer explicitement par `kind` selon le contexte (matière première une fois sur `Batch.recipeId`, packaging par allocation sur `allocation.recipeId`).
- **Fichiers** : `apps/api/src/batching/batch-preparation/batch-preparation.service.ts` (aucun changement de logique interne, seulement vérification/documentation), ses appelants listés ci-dessus.
- **Dépendances** : étape 1.
- **Risques** : faibles — pas de changement structurel, seulement des points d'appel ; non-régression à vérifier sur l'aperçu volume/masse déjà en production.
- **Tests** : non-régression des tests existants de `computeIngredientQuantities` (inchangés) ; nouveaux tests sur les appelants (filtrage correct par `kind`).
- **Estimation** : petite.

### Étape 8 — `BatchFeasibilityService` étendu

- **Objectif** : le besoin matière première reste vérifié une fois (recette de référence du batch, quantité totale planifiée = Σ allocations) ; le besoin packaging est agrégé sur toutes les allocations (sommé **avant** comparaison au stock disponible, pour ne pas compter deux fois un article de packaging partagé entre deux allocations).
- **Fichiers** : `apps/api/src/batching/batch-feasibility/batch-feasibility.service.ts` (+ `.spec.ts`).
- **Dépendances** : étapes 5, 7.
- **Risques** : moyens — le risque de double-comptage (ou d'omission) sur un article de packaging partagé est le point d'attention principal de cette étape.
- **Tests** : unitaires — batch à une allocation (non-régression stricte), deux allocations avec packaging distinct, deux allocations partageant un article de packaging (stock insuffisant détecté sur la somme, pas allocation par allocation).
- **Estimation** : moyenne.

### Étape 9 — `BatchStepsService.advance` : vérification défensive

- **Objectif** : aucun changement de principe (revérification via `BatchFeasibilityService` déjà étendu) ; ajout d'un contrôle défensif bloquant si le batch n'a aucune allocation (état normalement impossible après l'étape 6, à couvrir par prudence).
- **Fichiers** : `apps/api/src/production/batch-steps/batch-steps.service.ts` (+ `.spec.ts`).
- **Dépendances** : étape 8.
- **Risques** : faibles.
- **Tests** : unitaire du cas défensif.
- **Estimation** : petite.

### Étape 10 — Réécriture de `BatchClosureService` (le cœur du risque)

- **Objectif** :
  1. DTO de clôture : champs communs (`endedAt`, `formatChanged`, `formatChangeDetail`) + un tableau `allocations: [{ allocationId, producedQuantity, rejectedQuantity }]`.
  2. Consommation matière première calculée **une fois** (`Batch.recipeId` × Σ (`producedQuantity` + `rejectedQuantity`) de toutes les allocations), FIFO, déduction stock — inchangé dans son principe.
  3. Pour chaque allocation : consommation packaging (`allocation.recipeId` × sa quantité conforme+rebuts), FIFO, déduction stock, `StockMovement.batchProductAllocationId` renseigné.
  4. Génération d'un `Lot` par allocation (`LotNumberGeneratorService` appelé une fois par allocation), `Lot.allocationId` renseigné, `Lot.batchId` dénormalisé.
  5. Répartition de la généalogie matière première entre les lots des allocations, **au prorata de leur quantité traitée** (`producedQuantity + rejectedQuantity`, règle définitive du 2026-07-17 — remplace toute mention antérieure d'un prorata fondé sur les seuls volumes conformes) — plusieurs lignes `LotGenealogy` par `StockLot` matière première consommé si plusieurs allocations.
  6. Généalogie packaging : directement rattachée au lot de l'allocation concernée (conforme + rebuts).
  7. Écriture des agrégats `Batch.producedQuantity`/`rejectedQuantity` (= sommes) dans la **même transaction** que les quantités par allocation — invariant vérifié avant commit, rejet global sinon.
  8. **Chemin unique** : la boucle sur les allocations s'applique identiquement qu'il y en ait une seule ou plusieurs — aucun branchement mono/multi.
- **Fichiers** : `apps/api/src/production/batch-closure/batch-closure.service.ts` (+ `.spec.ts`), `dto/close-batch.dto.ts`.
- **Dépendances** : étapes 1, 5, 7.
- **Règle de répartition définitive (arbitrage du 2026-07-17)** :
  - clé = quantité traitée de l'allocation (`producedQuantity + rejectedQuantity`) ÷ quantité traitée totale du batch ;
  - la somme des lignes réparties doit reconstituer exactement la quantité consommée au `StockLot` d'origine ; le reliquat d'arrondi est affecté **déterministement à la dernière allocation traitée** (pas de nouveau calcul au prorata pour cette dernière ligne) ;
  - clôture refusée uniquement si `Σ (producedQuantity + rejectedQuantity)` sur toutes les allocations = 0 — remplace toute mention antérieure d'un prorata fondé sur les seuls volumes conformes, et résout par construction le cas limite de division par zéro (une allocation individuelle peut avoir une quantité traitée nulle sans bloquer la clôture, seule la somme du batch compte).
- **Risques** :
  - Précision `Decimal` : bien implémenter le reliquat déterministe sur la dernière allocation (pas un recalcul au prorata) pour garantir l'exactitude de la somme.
  - Invariant "somme des quantités réelles réparties par allocation = agrégats du batch" à valider côté service, pas seulement côté frontend.
  - Rupture de stock = toujours un rejet global agrégé (principe existant conservé), aucune écriture partielle.
- **Tests** : le plus grand nombre de scénarios de toute la feature — batch à une allocation (non-régression stricte vs comportement actuel), deux allocations avec quantités inégales, arrondi de prorata (vérifier la reconstitution exacte du total via le reliquat sur la dernière allocation), une allocation à quantité traitée nulle (0 conforme et 0 rebut) alors que d'autres allocations du batch ont une quantité traitée positive (ne bloque pas la clôture, cette allocation ne reçoit aucune ligne de généalogie matière première), clôture refusée quand la somme totale du batch est nulle, rupture de stock packaging sur une seule allocation (annule tout), rupture de stock matière première (annule tout).
- **Estimation** : **grande**.

### Étape 11 — Recensement des lectures `batch.lot` (singleton)

- **Objectif** : rechercher exhaustivement tout code (backend et frontend) supposant un seul lot par batch (`batch.lot`, types partagés, endpoints de lecture) et les adapter à `batch.allocations[].lot` ou à un nouvel endpoint de liste.
- **Fichiers** : à déterminer par recherche (`packages/shared`, controllers de lecture de batch, `apps/web/src/pages/ProductionPage.tsx`).
- **Dépendances** : étape 1 (peut démarrer dès la migration).
- **Risques** : **élevé si oublié** — régression silencieuse sur l'affichage du numéro de lot après clôture, pour tout batch (à une ou plusieurs allocations).
- **Tests** : grep exhaustif documenté + test e2e couvrant explicitement la lecture d'un batch à plusieurs lots.
- **Estimation** : petite (recherche) à moyenne (selon le nombre d'occurrences trouvées).

### Étape 12 — Frontend : écrans catalogue Marchés et Familles commerciales

- **Objectif** : `/catalog/markets` et `/catalog/product-families`, CRUD simples, calqués sur `/catalog/machines`/`/catalog/suppliers`. Sur la fiche d'un article `PRODUIT_FINI`, ajout des champs famille commerciale + marché (avec le message d'erreur explicite si le couple est déjà pris).
- **Fichiers** : nouvelles pages `apps/web/src/pages/catalog/MarketsPage.tsx`, `ProductFamiliesPage.tsx`, routing, client API, formulaire d'édition d'article existant.
- **Dépendances** : étapes 2, 3.
- **Risques** : faibles.
- **Tests** : vérification navigateur (pattern déjà couvert ailleurs, pas de test auto attendu).
- **Estimation** : petite à moyenne.

### Étape 13 — Frontend : ajout d'allocations avant conditionnement

- **Objectif** : dans le détail d'un batch, avant l'étape conditionnement, une section permet d'ajouter une sortie supplémentaire — si le produit de référence appartient à une famille, un simple choix de marché (liste filtrée aux marchés réellement déclinés) ; sinon, un choix de produit fini. Aucune recette n'est jamais affichée à choisir. Le formulaire de création de batch lui-même **ne change pas** dans le cas standard.
- **Fichiers** : `apps/web/src/pages/ProductionPage.tsx` (nouvelle section, formulaire de création inchangé).
- **Dépendances** : étape 6.
- **Risques** : moyens — bien préserver la simplicité du cas standard (aucun changement visible tant qu'aucune allocation n'est ajoutée).
- **Tests** : vérification navigateur — création standard (non-régression visuelle stricte), ajout d'un marché, ajout d'un produit hors famille, message d'erreur explicite si recette incompatible.
- **Estimation** : moyenne.

### Étape 14 — Frontend : clôture par allocation

- **Objectif** : remplacer `CloseBatchSection` (saisie unique produite/rebuts) par une saisie par allocation — un couple conforme/rebuts par sortie, visuellement équivalente à aujourd'hui pour un batch à une seule allocation (un seul couple de champs affiché).
- **Fichiers** : `apps/web/src/pages/ProductionPage.tsx` (`CloseBatchSection`).
- **Dépendances** : étape 10.
- **Risques** : moyens.
- **Tests** : vérification navigateur — clôture à une allocation (non-régression), clôture à plusieurs allocations, message d'erreur si incohérence de saisie.
- **Estimation** : moyenne.

### Étape 15 — Frontend : affichage multi-lots

- **Objectif** : adapter l'affichage du détail batch pour montrer un numéro de lot par allocation (au lieu d'un seul), et le récapitulatif des allocations dans la vue détail avant clôture.
- **Fichiers** : `apps/web/src/pages/ProductionPage.tsx`.
- **Dépendances** : étapes 11, 14.
- **Risques** : faibles.
- **Tests** : vérification navigateur.
- **Estimation** : petite.

### Étape 16 — Tests de non-régression dédiés

- **Objectif** : verrouiller explicitement, au-delà des tests unitaires déjà prévus par étape, que (a) un batch standard (une seule allocation, produit sans famille) se comporte à l'identique du point de vue utilisateur, et (b) les batchs/lots antérieurs à la feature restent lisibles sans erreur.
- **Fichiers** : `apps/api/test/production.e2e-spec.ts` (nouveaux cas), nouveau fichier e2e dédié `apps/api/test/batch-product-allocation.e2e-spec.ts`.
- **Dépendances** : toutes les étapes backend (1 à 11).
- **Risques** : c'est le filet de sécurité de toute la feature — à ne pas sauter même sous contrainte de calendrier.
- **Tests** : eux-mêmes.
- **Estimation** : moyenne.

### Étape 17 — Documentation post-développement

- **Objectif** : mettre à jour `PROJECT_STATE.md` (nouvelle section décisions techniques + statut), `MASTER_BACKLOG.md` (PRD-11 → Terminé), clore l'ADR 0006 avec le retour d'expérience réel de l'implémentation de la règle de répartition (décision 20).
- **Fichiers** : `PROJECT_STATE.md`, `MASTER_BACKLOG.md`, `docs/adr/0006-allocation-marche-batch.md`.
- **Dépendances** : toutes les précédentes.
- **Risques** : faibles, mais obligatoire selon la règle du projet (qualité minimale du socle commun `lca-ai-core`).
- **Estimation** : petite.

---

## Risques transverses à garder en tête sur toute la feature

1. **Reliquat d'arrondi du prorata de généalogie matière première** (étape 10) — doit impérativement être affecté à la dernière allocation traitée (règle définitive, décision 20), jamais recalculé au prorata pour cette dernière ligne, sous peine d'écart entre la somme des lignes de généalogie et la quantité réellement consommée au `StockLot`.
2. **Retrait de l'unicité `Lot.batchId`** (étape 1) — dépend entièrement de la rigueur du recensement de l'étape 11.
3. **Invariants transactionnels sur `Batch`** (agrégats = sommes des allocations) — aucune contrainte déclarative PostgreSQL simple ne peut les garantir nativement ; toute écriture doit impérativement passer par les services dédiés (`BatchProductAllocationsService`, `BatchClosureService`), jamais par un accès direct à `prisma.batch.update()` ailleurs dans le code.
4. **Agrégation du besoin packaging** en cas de partage d'un même article entre plusieurs allocations (étape 8) — sommer avant comparaison au stock, jamais allocation par allocation indépendamment.

## Ce qui n'est plus nécessaire (grâce aux dernières itérations de la revue)

- Pas de scission de `BatchPreparationService` en deux méthodes distinctes.
- Pas de service de comparaison dédié avec état — une fonction pure suffit.
- Pas de rupture de contrat sur `CreateBatchDto` — changement additif.
- Pas de double chemin de traitement dans `BatchClosureService` selon le nombre d'allocations.
