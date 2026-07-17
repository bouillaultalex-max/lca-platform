# PRD-11 — Revue d'architecture : Allocation multi-marchés

Voir `docs/adr/0006-allocation-marche-batch.md` pour la décision d'architecture formelle (révisée le 2026-07-17). Ce document détaille le raisonnement, les impacts sur le code existant, et l'historique des itérations ayant conduit à la version finale.

## Historique de la revue

Cinq itérations successives, demandées explicitement par l'utilisateur avant tout code (aucune ligne de la version du 2026-07-16 n'a été implémentée) :

1. **Modèle initial (2026-07-16)** : `BatchMarketAllocation` avec lignes de packaging saisies librement par allocation.
2. **Itération 1** : le packaging n'est plus saisi librement — il est dérivé automatiquement de la recette du produit fini de l'allocation. Introduction d'une notion de "compatibilité" entre recettes (composition matière première identique).
3. **Itération 2** : introduction de `ProductFamily` — le catalogue résout automatiquement le produit correspondant à un marché, l'utilisateur ne choisit ni recette ni produit quand le marché suffit.
4. **Itération 3** : généralisation en `BatchProductAllocation` — tout batch, même standard, possède au moins une allocation ; un seul chemin de traitement dans tous les services concernés ; `Batch` conserve ses champs globaux comme agrégats authentiques (option de suppression étudiée puis reportée).
5. **Itération 4 (arbitrage final)** : la clé de répartition de la généalogie matière première est définitivement fixée à la quantité traitée (`producedQuantity + rejectedQuantity`) de chaque allocation, et non aux seuls volumes conformes — les rebuts consomment réellement le mélange commun. Cette règle résout au passage le cas limite de division par zéro identifié à l'itération 3 (une clôture n'est refusée que si la quantité traitée totale du batch est nulle).

## Résumé de la décision finale

Un batch représente un run physique unique autour d'un seul mélange commun. Il produit une ou plusieurs sorties commerciales (`BatchProductAllocation`), chacune portant un produit fini, une recette figée (résolue automatiquement, jamais choisie directement par l'utilisateur), éventuellement un marché, et ses propres quantités (planifiée, produite, rebuts). Le mélange (matières premières) reste calculé une seule fois pour tout le batch, sur la recette de référence portée par `Batch.recipeId` ; seuls le packaging, les rebuts, la quantité produite et le lot final sont propres à chaque allocation.

## Impacts détaillés sur les services existants

### `BatchPreparationService`
**Aucun changement structurel.** `computeIngredientQuantities()` garde sa forme actuelle (retourne matière première et packaging, tagués par `kind`, pour une recette et une quantité données). Seul l'usage du résultat diffère selon le contexte :
- appelé une fois avec `(Batch.recipeId, quantité totale du batch)`, seules les lignes `MATIERE_PREMIERE` du résultat sont retenues (besoin commun) ;
- appelé une fois par allocation avec `(allocation.recipeId, allocation.plannedQuantity)`, seules les lignes `PACKAGING` du résultat sont retenues.

### `BatchesService.create`
Changement additif, pas de rupture : le formulaire de création (recette, machine, quantité) reste inchangé dans le cas standard. Le service crée en plus, dans la même transaction, la première `BatchProductAllocation` (résolue depuis la recette choisie). L'ajout d'allocations supplémentaires est une opération séparée (nouveau service dédié), possible avant l'étape conditionnement.

### `BatchFeasibilityService` (ADR 0005)
Le principe (double vérification lancement/clôture, jamais de divergence) reste entièrement valide. Le besoin matière première reste vérifié une fois pour le batch (recette de référence) ; le besoin en packaging est agrégé sur l'ensemble des allocations avant comparaison au stock disponible — attention à ne pas compter deux fois le même article de packaging si deux allocations le partagent.

### `BatchClosureService`
Impact le plus structurant, mais désormais **un seul chemin de traitement**, quel que soit le nombre d'allocations (1 ou plusieurs) :
1. Consommation matière première calculée une fois (recette de référence × quantité totale conforme+rebuts), FIFO, répartie en généalogie entre les lots de chaque allocation au prorata de leur quantité traitée (conforme + rebuts, voir arbitrage définitif ci-dessous).
2. Consommation packaging calculée par allocation (sa recette × sa quantité conforme+rebuts), FIFO, généalogie directement rattachée à son lot.
3. Un `Lot` généré par allocation.
4. Écriture des agrégats `Batch.producedQuantity`/`rejectedQuantity` et des quantités par allocation dans la même transaction, avec vérification des invariants (voir ADR 0006 §6).

### `LotNumberGeneratorService`
Aucun changement interne requis. Appelé une fois par allocation plutôt qu'une fois par batch — confirme la pertinence de l'avoir isolé dès l'origine (`docs/regles-metier.md` §4).

### `BatchStepsService`
Aucun changement de principe (revérification via `BatchFeasibilityService` déjà étendu) ; ajout d'une vérification défensive (batch sans aucune allocation, état normalement impossible après la création).

### Catalogue (`catalog`)
Nouveaux modules `catalog/markets` et `catalog/product-families` (CRUD simples, calqués sur `Machine`/`Supplier`). `ArticlesService` gagne une règle de validation : `marketId` ne peut être renseigné que si `productFamilyId` l'est aussi.

### Frontend (`ProductionPage.tsx`)
- Création de batch : formulaire inchangé pour le cas standard. Ajout d'une section optionnelle "Ajouter un marché" (si le produit appartient à une famille) ou "Ajouter un produit" (sinon), avant l'étape conditionnement.
- Clôture : saisie par allocation (quantité conforme + rebuts par sortie) au lieu d'une saisie unique — visuellement équivalente à aujourd'hui pour un batch à une seule allocation.
- Détail du batch : affichage d'un numéro de lot par allocation.

## Conditions initiales et leur résolution

| Condition | Résolution |
|---|---|
| Méthode de saisie du packaging par allocation | **Résolue (itération 1)** : dérivée automatiquement de la recette du produit fini, jamais saisie librement |
| Association produit ↔ marché | **Résolue (itération 2)** : portée par le catalogue (`ProductFamily`), jamais saisie en production |
| Portée de l'allocation (mono vs multi-marché) | **Résolue (itération 3)** : généralisée à `BatchProductAllocation`, tout batch en a au moins une, un seul chemin de traitement |
| Conservation ou suppression des champs globaux de `Batch` | **Résolue** : conservés comme agrégats authentiques, vérifiés par invariants transactionnels ; suppression réévaluable plus tard |
| Méthode de répartition proportionnelle de la généalogie (matière première) | **Résolue (2026-07-16, révisée et figée le 2026-07-17)** : au prorata de la quantité traitée (`producedQuantity + rejectedQuantity`) de chaque allocation — remplace la version initiale fondée sur les seuls volumes conformes ; les rebuts consomment réellement le mélange et reçoivent donc leur part de généalogie |
| Stratégie de migration des données historiques | **Résolue (2026-07-16)** : aucun backfill, aucune modification rétroactive |
| Cohérence du champ dénormalisé `Lot.batchId` | **Résolue (2026-07-16)** : conservé tel quel, `Lot.allocationId` ajouté en complément |
| Cas limite "quantité conforme totale nulle" (division par zéro sur le prorata) | **Résolue (2026-07-17)** : sans objet avec la nouvelle clé — une clôture n'est refusée que si la somme des quantités **traitées** (conforme + rebuts) de toutes les allocations est nulle ; le reliquat d'arrondi est affecté déterministement à la dernière allocation |

Aucune condition bloquante ne subsiste : l'architecture est validée et figée, la feature est prête pour développement (voir `plan-developpement.md`).

## Points à traiter en phase de développement (non bloquants pour le cadrage)

- Ordre exact d'introduction des endpoints (catalogue `Market`/`ProductFamily`, création de batch, gestion des allocations, clôture) — détaillé dans `plan-developpement.md`.
- Tests de non-régression explicites pour les batchs à allocation unique (comportement utilisateur identique à aujourd'hui) et pour la lecture des batchs/lots historiques (sans allocation).

## Risques identifiés

- **Risque de régression sur les batchs existants** si la nouvelle relation `Batch 1──n Lot` n'est pas traitée avec la même rigueur que l'actuelle `Batch 1──1 Lot` dans tout le code qui en dépend (ex. tout endroit lisant `batch.lot` en s'attendant à un singleton).
- **Risque d'incohérence des agrégats `Batch`** si un futur développeur modifie une allocation sans repasser par la couche service dédiée, contournant la vérification transactionnelle des invariants — aucune contrainte base de données ne peut empêcher cela nativement (une somme n'est pas exprimable comme contrainte déclarative simple en PostgreSQL sans trigger dédié, non retenu pour rester dans l'esprit "logique métier dans les services" du projet).
- **Risque d'agrégation incorrecte du besoin packaging** en cas de partage d'un même article de packaging entre plusieurs allocations, si `BatchFeasibilityService` comparait allocation par allocation au lieu de sommer avant comparaison au stock.
