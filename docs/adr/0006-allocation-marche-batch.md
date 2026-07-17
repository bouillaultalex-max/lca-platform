# ADR 0006 — Allocation produit/marché ↔ batch

## Statut

Accepté — 2026-07-16. **Révisé et figé — 2026-07-17** (avant toute implémentation, aucun code écrit sur la version initiale).

## Historique des révisions

- **2026-07-16** : décision initiale — introduction de `Market` et `BatchMarketAllocation`, packaging saisi librement par allocation.
- **2026-07-17 (revue d'architecture)** : quatre itérations successives ont abouti à un modèle sensiblement différent de la version initiale :
  1. Le packaging n'est plus saisi librement : il est **dérivé automatiquement de la recette du produit fini** de chaque allocation (la recette reste la source unique de vérité de sa composition, matière première + packaging).
  2. Introduction de `ProductFamily` (déclinaisons commerciales par marché) : le catalogue connaît nativement quel produit correspond à quel marché, l'utilisateur n'associe jamais lui-même un produit à un marché dans l'écran de production.
  3. Généralisation de `BatchMarketAllocation` en **`BatchProductAllocation`** : un batch standard (produit sans déclinaison commerciale) possède aussi une allocation — un seul chemin de traitement, plus de distinction mono/multi-marché dans le code.
  4. `Batch` conserve ses champs globaux (`recipeId`, `format`, `plannedQuantity`, `producedQuantity`, `rejectedQuantity`) comme agrégats authentiques, vérifiés par des invariants transactionnels, et non comme une simple copie du premier enregistrement.
- **2026-07-17 (arbitrage définitif de répartition)** : la clé de répartition de la généalogie matière première (et du coût du mélange, qui suit la même clé) est définitivement fixée à `producedQuantity + rejectedQuantity` (quantité traitée) par allocation, et non plus aux seuls volumes conformes — les rebuts consomment réellement le mélange et doivent donc recevoir leur part de généalogie. Voir décision 20 ci-dessous. **Remplace toute mention antérieure d'un prorata fondé uniquement sur les volumes conformes.**

  Ce document remplace intégralement la version du 2026-07-16 ; il n'y a pas eu de code développé sur l'ancienne version.

## Contexte

Retour métier validé humainement (feature `PRD-11`, voir `docs/features/PRD-11-allocation-multi-marches/`) : un batch de production doit pouvoir produire plusieurs sorties commerciales distinctes (par exemple un produit "classique" et sa déclinaison "label Suisse") à partir d'un seul mélange commun, chaque sortie recevant son propre lot fini avec son propre packaging.

La notion de "marché" (destination commerciale ou réglementaire, ex. France, Suisse) est **indépendante du multi-site** : LCA-MES reste mono-site en V0.9 (`siteId` continue de désigner le site de production physique, voir ADR 0001 §8) ; un marché est une propriété optionnelle d'un produit fini, pas un lieu de production.

## Principe directeur

> Une recette reste la source unique de vérité de la composition d'un produit fini (matière première + packaging). Un batch représente un run physique unique autour d'**un seul mélange** ; chaque `BatchProductAllocation` représente une sortie commerciale de ce run (un produit fini, sa recette figée, éventuellement un marché). L'utilisateur choisit toujours un produit fini ou un marché — jamais une recette directement, la recette étant la définition technique du produit, résolue et figée automatiquement par le serveur.

## Décisions métier validées (récapitulatif intégral, 2026-07-16 et 2026-07-17)

1. Un batch peut produire plusieurs sorties commerciales (allocations) à partir d'un seul mélange.
2. Une seule allocation par marché dans un même batch (quand un marché est renseigné) ; une seule allocation par produit fini dans un même batch, dans tous les cas.
3. Une allocation génère exactement un lot fini.
4. Le mélange (matières premières) est commun à tout le batch : une seule recette de référence, un seul calcul de besoin matière première.
5. Le packaging peut différer selon l'allocation — dérivé automatiquement de la recette du produit fini de l'allocation, jamais saisi librement.
6. La répartition entre allocations (quantité prévue) est définie avant l'étape de conditionnement.
7. Les rebuts sont suivis par allocation.
8. Les consommations de packaging sont calculées sur conforme + rebuts, par allocation.
9. Le coût du mélange sera réparti proportionnellement entre allocations (même clé que la généalogie, décision 20) ; le packaging sera calculé directement par allocation (Jalon 3, `BatchCost`, non codé à ce jour).
10. Commandes, expéditions et règles réglementaires détaillées par marché sont hors périmètre.
11. La généalogie du mélange commun est répartie entre allocations au prorata de leur quantité traitée (`producedQuantity + rejectedQuantity`), voir décision 20 — **remplace la règle initiale du 2026-07-16 fondée sur les seuls volumes conformes**.
12. Aucun backfill ni modification rétroactive des données historiques : les batchs déjà clôturés restent tels quels.
13. Les batchs antérieurs à cette feature restent sans allocation (relation directe `Lot.batch`, `Lot.allocationId = null`).
14. `StockMovement` reçoit un `batchProductAllocationId` nullable, renseigné uniquement pour les sorties de packaging propres à une allocation.
15. **Le catalogue connaît nativement les déclinaisons commerciales d'un produit** (`ProductFamily` + `Article.marketId`) : l'utilisateur ne peut pas associer un produit à un marché de façon incohérente dans l'écran de production — cette association est une donnée de catalogue, pas une saisie de production.
16. **Tout nouveau batch possède au moins une allocation**, y compris un batch sur un produit standalone (sans famille commerciale) : ce n'est pas un cas particulier, `BatchClosureService` (et les autres services concernés) n'ont qu'un seul chemin de traitement.
17. **`Batch` conserve ses champs globaux comme agrégats authentiques** (`recipeId` = recette de référence du mélange commun, `format` = format physique unique du run, `plannedQuantity`/`producedQuantity`/`rejectedQuantity` = sommes des allocations), vérifiés par des invariants transactionnels — pas une simple copie dénormalisée de la première allocation.
18. **`productId` et `recipeId` sont tous deux portés par l'allocation** : `productId` identifie la sortie commerciale, `recipeId` fige la définition technique réellement utilisée ; le serveur vérifie systématiquement que `recipe.finishedProductId` correspond à `productId`.
19. La suppression des champs globaux de `Batch` (candidate un temps envisagée) est **reportée** : trop de refactor pour trop peu de valeur métier à ce stade.
20. **Règle définitive de répartition de la généalogie matière première** (arbitrage du 2026-07-17, remplace toute mention antérieure d'un prorata fondé uniquement sur les volumes conformes) :
    - la clé de répartition entre allocations est la **quantité traitée** de chaque allocation, `producedQuantity + rejectedQuantity` (et non les seuls volumes conformes) — les rebuts consomment réellement le mélange et doivent donc recevoir leur part de généalogie matière première ;
    - pour chaque allocation : `part = quantité traitée de l'allocation ÷ quantité traitée totale du batch` ;
    - la somme des lignes de généalogie réparties doit reconstituer exactement la quantité totale consommée au `StockLot` d'origine ; le reliquat éventuel dû aux arrondis est affecté **déterministement à la dernière allocation** traitée ;
    - une clôture est refusée uniquement si la somme des quantités traitées de toutes les allocations du batch est nulle (`Σ (producedQuantity + rejectedQuantity) = 0`) — ce qui résout, par construction, le cas limite de division par zéro identifié lors de la revue d'architecture ;
    - le coût du mélange (Jalon 3, `BatchCost`) suivra la même clé de répartition.

## Décision

### 1. Nouvelle entité `Market` (référentiel)
Entité dédiée (code, libellé, actif), dans l'esprit de `Supplier`/`Machine`.

### 2. Nouvelle entité `ProductFamily` (référentiel)
Regroupe les déclinaisons commerciales d'un même produit par marché (ex. "Recharge Lavande" → déclinaisons France et Suisse). Champs : nom, actif.

**Distinct de la future notion de "gamme"** mentionnée dans `MASTER_BACKLOG.md` (DEBT-05, regroupement de produits pour la planification) — les deux concepts répondent à des besoins différents et ne doivent pas être fusionnés à ce stade.

### 3. `Article` (ajouts, pertinents uniquement pour `type = PRODUIT_FINI`)
- `productFamilyId` (nullable, FK `ProductFamily`).
- `marketId` (nullable, FK `Market`) — ne peut être renseigné que si `productFamilyId` l'est aussi (règle de service).
- Contrainte d'unicité `(productFamilyId, marketId)` : une famille ne peut jamais avoir deux déclinaisons pour le même marché — structurellement impossible à violer, y compris via l'API.

### 4. `Batch` : agrégats authentiques, structure inchangée
`recipeId`, `format`, `plannedQuantity`, `producedQuantity`, `rejectedQuantity` sont conservés avec leur sens actuel, réinterprétés comme :
- `recipeId` = recette de référence du mélange commun (celle utilisée pour le calcul unique de matière première) ;
- `format` = format physique unique du run, hérité de cette recette ;
- `plannedQuantity`/`producedQuantity`/`rejectedQuantity` = sommes des allocations, écrites et vérifiées dans la même transaction que les allocations elles-mêmes (jamais une simple copie asynchrone).

### 5. Nouvelle entité `BatchProductAllocation` (remplace le nom provisoire `BatchMarketAllocation`)
- `batchId` → FK `Batch`.
- `productId` → FK `Article` (type `PRODUIT_FINI`) — identifie la sortie commerciale.
- `recipeId` → FK `Recipe` — définition technique réellement utilisée, figée à la création de l'allocation (immuable ensuite, même principe que la recette d'un batch aujourd'hui). Le serveur vérifie systématiquement `recipe.finishedProductId === productId`.
- `marketId` → FK `Market`, nullable — présent uniquement si le produit appartient à une famille commerciale.
- `plannedQuantity` ; `producedQuantity`, `rejectedQuantity` (nullables jusqu'à la clôture).
- Contrainte d'unicité `(batchId, productId)` (toujours) et `(batchId, marketId)` (quand non nul).
- Relation `1─1` avec `Lot`.

### 6. Invariants obligatoires (vérifiés côté serveur, dans la même transaction que les écritures)
1. `Batch.plannedQuantity` = Σ `allocations.plannedQuantity`.
2. `Batch.producedQuantity` = Σ `allocations.producedQuantity` (à la clôture).
3. `Batch.rejectedQuantity` = Σ `allocations.rejectedQuantity` (à la clôture).
4. Toutes les recettes des allocations d'un batch partagent le même format que `Batch.format`.
5. Toutes les recettes des allocations d'un batch ont une composition matière première strictement compatible avec `Batch.recipeId` — comparaison pure (articles + quantités par unité des lignes `MATIERE_PREMIERE`), non stockée, vérifiée une seule fois à l'ajout de chaque allocation (les recettes sont immuables ensuite).
6. `recipe.finishedProductId` = `allocation.productId` pour chaque allocation.

### 7. Flux de création et d'ajout d'allocation
- **Création d'un batch** : formulaire inchangé dans le cas standard (recette, machine, quantité). Le serveur crée automatiquement la première `BatchProductAllocation` (`productId` dérivé de la recette choisie, `recipeId` = recette choisie, `marketId` = marché de la déclinaison si le produit appartient à une famille, sinon `null`).
- **Ajout d'une allocation supplémentaire** (autorisé tant que `currentStep !== CONDITIONNEMENT`) :
  - si le produit de référence appartient à une famille commerciale : l'utilisateur choisit uniquement un **marché** parmi ceux réellement déclinés dans cette famille (liste construite depuis le catalogue, aucun choix incohérent possible) — produit et recette résolus automatiquement ;
  - sinon : l'utilisateur choisit directement un **produit fini** existant — la recette reste toujours résolue automatiquement (recette `ACTIVE` de ce produit au format du batch), jamais choisie à la main ;
  - dans les deux cas, les invariants 4/5/6 ci-dessus sont vérifiés ; toute violation bloque la création avec un message explicite (produit sans recette active à ce format, ou composition matière première divergente).

### 8. `Lot`
- `allocationId` (nouveau, nullable) → FK `BatchProductAllocation`, relation `1─1`. Renseigné pour tout lot généré via cette feature.
- `batchId` (existant, inchangé, non-nullable) → FK `Batch`, conservé pour les lectures et la traçabilité, dénormalisé depuis `allocation.batchId` pour tout nouveau lot.
- Retrait de la contrainte d'unicité sur `batchId` (`Batch 1──n Lot` désormais, via les allocations — un seul lot de fait pour un batch à allocation unique).
- Pour les lots antérieurs à cette feature : `allocationId` reste `null`, `batchId` est l'unique rattachement, exactement comme aujourd'hui.

### 9. `StockMovement`
`batchProductAllocationId` (nouveau, nullable) → FK `BatchProductAllocation` : renseigné pour une sortie de packaging propre à une allocation, laissé vide pour une sortie de matière première (mélange commun, non ventilé par allocation).

### 10. `BatchClosureService` : un seul chemin de traitement
Quel que soit le nombre d'allocations (1 ou plusieurs) :
1. Consommation matière première calculée **une fois** pour tout le batch (`Batch.recipeId` × quantité totale conforme+rebuts), FIFO, répartie en généalogie entre les lots des allocations **au prorata de leur quantité traitée** (`producedQuantity + rejectedQuantity`, voir décision 20) — le reliquat d'arrondi est affecté déterministement à la dernière allocation traitée, pour garantir que la somme reconstitue exactement la quantité consommée.
2. Consommation packaging calculée **par allocation** (sa recette × sa quantité conforme+rebuts), FIFO, généalogie directement rattachée au lot de l'allocation.
3. Un `Lot` généré par allocation ; `LotNumberGeneratorService` appelé une fois par allocation (service lui-même inchangé).
4. Écriture des agrégats `Batch.producedQuantity`/`rejectedQuantity` et des quantités par allocation dans la même transaction.
5. Clôture refusée si la somme des quantités traitées de toutes les allocations est nulle (décision 20).

### 11. `LotNumberGeneratorService`
Aucun changement interne requis — appelé une fois par allocation plutôt qu'une fois par batch.

### 12. Données historiques
Aucun backfill, aucune migration rétroactive. Les batchs antérieurs à cette feature n'ont et n'auront jamais d'allocation ; leurs lots gardent `allocationId = null`. Tout nouveau batch suit obligatoirement le nouveau modèle (au moins une allocation).

## Alternatives envisagées et écartées

- **Packaging saisi librement par allocation** (version du 2026-07-16) : écartée — le catalogue contient déjà des produits finis distincts par marché (ex. "label Suisse") ; dupliquer cette information en saisie libre dans le batch aurait créé une source de vérité concurrente de la recette.
- **Allocation référençant une recette choisie directement par l'utilisateur** : écartée — contredit le principe "la recette est la définition technique du produit, jamais choisie directement" ; source d'erreurs de sélection sans garde-fou.
- **Comparaison de compatibilité matière première via un champ stocké (hash) sur `Recipe`** : écartée pour l'instant — le volume de recettes/allocations ne justifie pas l'optimisation ; une fonction pure suffit, sans migration sur une table centrale.
- **Association produit ↔ marché laissée à la saisie libre en production** : écartée — risque d'association incohérente (ex. deux produits pour le même marché dans un même batch) ; déplacée dans le catalogue (`ProductFamily`) où elle est structurellement garantie cohérente.
- **Allocation optionnelle, réservée aux seuls batchs multi-marché** (deux chemins de traitement dans `BatchClosureService`) : écartée — un seul chemin de traitement est plus sûr et plus simple à maintenir qu'une distinction mono/multi-marché dupliquée dans plusieurs services.
- **Suppression des champs globaux de `Batch`** (`recipeId`/`format`/quantités), au profit d'une lecture exclusivement dérivée des allocations : écartée pour cette itération — trop de refactor sur des services déjà en production (`BatchesService`, `BatchPreparationService`, `BatchFeasibilityService`, `BatchStepsService`) pour un bénéfice de simplicité marginal. Les champs globaux restent des agrégats authentiques, garantis par des invariants transactionnels plutôt que par construction structurelle — option réévaluable plus tard si le besoin réel s'en fait sentir.
- **Remplacer `Lot.batchId` par `Lot.allocationId` sans conserver le premier** : écartée — aurait nécessité une migration rétroactive de toutes les données historiques, contredisant la décision 12.
- **Backfill d'une allocation "par défaut" pour les batchs déjà clôturés** : écartée explicitement — aucune modification rétroactive des données historiques.
- **Répartition de la généalogie matière première au prorata des seuls volumes conformes** (version du 2026-07-16) : écartée le 2026-07-17 — les rebuts consomment réellement le mélange commun ; les exclure de la clé de répartition aurait laissé une partie de la matière première consommée sans généalogie rattachée à aucune allocation. Remplacée par une clé fondée sur la quantité traitée (`producedQuantity + rejectedQuantity`, décision 20).
- **Repli sur la quantité planifiée en cas de volumes conformes totaux nuls** (piste envisagée pendant la revue) : devenue sans objet — la nouvelle clé (quantité traitée) ne peut être nulle que si le batch entier n'a produit et rejeté aucune unité sur aucune allocation, cas dans lequel la clôture est simplement refusée (décision 20).

## Conséquences

- Impact structurant sur le modèle de données : nouvelles entités `Market`, `ProductFamily`, `BatchProductAllocation` ; ajouts sur `Article` (`productFamilyId`, `marketId`), `Lot` (`allocationId`, retrait de l'unicité sur `batchId`), `StockMovement` (`batchProductAllocationId`) — détaillé dans `docs/modele-donnees.md` §1bis, §4bis, §5.
- Impact sur quatre services existants (`BatchesService`, `BatchPreparationService`, `BatchFeasibilityService`, `BatchClosureService`) et sur `BatchStepsService` (vérification défensive) — un seul chemin de traitement dans chacun, plus de branchement mono/multi-allocation.
- Impact frontend : formulaire de création de batch (sélection de marché ou de produit pour les allocations additionnelles), écran de clôture (saisie par allocation) — le cas standard (une seule allocation, produit sans famille) reste visuellement et fonctionnellement identique à aujourd'hui.
- **Aucune migration de données requise** pour les batchs/lots historiques : coexistence de `Lot.batchId` (toujours renseigné) et `Lot.allocationId` (nullable, nouveau).
- `LotNumberGeneratorService` confirme la pertinence de son isolement dès l'origine (`docs/regles-metier.md` §4) : aucune modification interne, seulement des appels supplémentaires.
- Le calcul de faisabilité (ADR 0005) reste valide dans son principe (double vérification lancement/clôture, jamais de divergence) ; son périmètre de calcul s'étend à l'agrégation du besoin packaging sur toutes les allocations.
- Si un futur écran nécessite un contrôle similaire "aperçu avant action irréversible, revérifié indépendamment à l'exécution réelle", le même patron pourra être réutilisé (déjà observé avec les imports OpenSi et l'ADR 0005).
