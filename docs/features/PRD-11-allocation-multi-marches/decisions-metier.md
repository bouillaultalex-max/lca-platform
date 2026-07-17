# PRD-11 — Décisions métier

Procès-verbal des décisions métier validées humainement pour la feature `PRD-11` (Allocation multi-marchés). Document déclaratif : aucune interprétation, aucun arbitrage technique — voir `revue-architecture.md` et `docs/adr/0006-allocation-marche-batch.md` pour la traduction en architecture.

## Contexte

Validé le 2026-07-16, avec l'utilisateur (responsable adjoint / product owner du projet). Révisé le 2026-07-17 lors d'une revue d'architecture demandée explicitement avant tout code — le modèle initial du 2026-07-16 n'a jamais été implémenté.

Clarification préalable :
- LCA-MES reste mono-site.
- Le multi-marché ne signifie pas multi-site.
- Un marché est une destination commerciale ou réglementaire, par exemple France ou Suisse.

## Décisions métier validées (1ère série, 2026-07-16)

1. Un batch peut contenir plusieurs allocations de marché.
2. Une seule allocation par marché dans un même batch.
3. Une allocation génère exactement un lot fini.
4. Le mélange et la recette sont communs.
5. Le packaging peut différer selon le marché.
6. La répartition est définie avant le conditionnement.
7. Les rebuts sont suivis par allocation.
8. Les consommations de packaging sont calculées sur conforme + rebuts.
9. Le coût du mélange sera réparti proportionnellement ; le packaging sera calculé par allocation.
10. Les commandes, expéditions et règles réglementaires détaillées sont hors périmètre.

## Arbitrages complémentaires validés (2ème série, 2026-07-16)

11. ~~La généalogie est répartie proportionnellement aux volumes conformes uniquement.~~ **Remplacée le 2026-07-17, voir 6ème série ci-dessous** : la clé de répartition retenue est la quantité traitée (conforme + rebuts), pas les seuls volumes conformes.
12. Aucun backfill ni modification rétroactive des données historiques.
13. Les anciens batchs restent mono-marché.
14. `StockMovement` reçoit un `batchProductAllocationId` nullable (renommé depuis `batchMarketAllocationId`, voir 3ème série).

## Révision architecturale (3ème série, 2026-07-17 — remplace le modèle initial de saisie libre du packaging)

Demandée explicitement par l'utilisateur avant tout code : *"Je pense que le modèle introduit une séparation artificielle entre matière première et packaging alors que ce sont deux composantes d'une recette."*

15. La recette reste la source unique de vérité de la composition d'un produit (matière première **et** packaging) — aucune saisie libre de lignes de packaging dans le batch.
16. Le packaging d'une allocation est **dérivé automatiquement** de la recette du produit fini de cette allocation, jamais saisi manuellement.
17. Deux recettes sont "compatibles" si leur composition matière première (articles + quantités par unité) et leur format sont strictement identiques — vérifié automatiquement à l'ajout de chaque allocation, comparaison bloquante en cas de divergence.
18. Principe : **un batch = un seul mélange ; plusieurs allocations = plusieurs produits finis utilisant ce même mélange.**

## Révision architecturale (4ème série, 2026-07-17 — résolution automatique produit/marché)

Demandée explicitement par l'utilisateur : *"L'utilisateur ne choisit jamais une recette pour une allocation ; l'utilisateur ne choisit idéalement pas non plus un produit si celui-ci est entièrement déterminé par le marché."*

19. Nouvelle entité `ProductFamily` : le catalogue connaît nativement les déclinaisons commerciales d'un produit par marché (ex. France → produit classique, Suisse → produit "label Suisse").
20. Quand le produit de référence d'un batch appartient à une famille commerciale, l'ajout d'une allocation supplémentaire ne demande qu'un **marché** — produit et recette sont résolus automatiquement depuis le catalogue.
21. Aucune association produit ↔ marché incohérente n'est possible : cette association est une donnée de catalogue (contrainte d'unicité `(famille, marché)`), pas une saisie de production.
22. `ProductFamily` est un concept **distinct** de la future notion de "gamme" (`MASTER_BACKLOG.md`, DEBT-05, regroupement de produits pour la planification) — non fusionnés à ce stade.

## Révision architecturale (5ème série, 2026-07-17 — généralisation de l'allocation)

Demandée explicitement par l'utilisateur : *"Même un batch standard sur un produit sans famille possède une sortie [...] L'entité ne devrait donc plus être pensée uniquement comme une 'allocation de marché'."*

23. L'entité `BatchMarketAllocation` est renommée **`BatchProductAllocation`** et généralisée : elle représente toute sortie produite par un batch, avec ou sans marché associé.
24. Tout nouveau batch possède **au moins une allocation**, y compris un batch standard sur un produit sans famille commerciale — ce n'est pas un cas particulier.
25. `BatchClosureService` (et les autres services concernés) utilisent un **seul chemin de traitement**, quel que soit le nombre d'allocations.
26. `Batch` conserve ses champs globaux (`recipeId`, `format`, `plannedQuantity`, `producedQuantity`, `rejectedQuantity`) comme **agrégats authentiques** — vérifiés par des invariants transactionnels, pas une simple copie de la première allocation.
27. `productId` et `recipeId` sont tous deux portés par l'allocation : `productId` identifie la sortie commerciale, `recipeId` fige la définition technique réellement utilisée ; le serveur vérifie que `recipe.finishedProductId` correspond à `productId`.
28. Les batchs antérieurs à cette feature restent compatibles sans modification : ils peuvent ne pas avoir d'allocation, leurs lots conservent `allocationId = null`. Tout nouveau batch suit obligatoirement le nouveau modèle.
29. La suppression des champs globaux de `Batch` (option envisagée un temps) est reportée — trop de refactor pour trop peu de valeur métier à ce stade.

## Arbitrage métier définitif (6ème série, 2026-07-17 — répartition de la généalogie matière première)

Dernier point ouvert de la revue d'architecture, tranché explicitement par l'utilisateur : *"Les rebuts consomment réellement le mélange et doivent donc recevoir leur part de généalogie matière première."*

30. La clé de répartition de la généalogie matière première entre allocations est la **quantité traitée** de chaque allocation : `producedQuantity + rejectedQuantity` (et non les seuls volumes conformes, contrairement à la décision 11 initiale).
31. Pour chaque allocation : `part = quantité traitée de l'allocation ÷ quantité traitée totale du batch`.
32. La somme des lignes réparties doit reconstituer exactement la quantité totale consommée ; le reliquat éventuel dû aux arrondis est affecté déterministement à la dernière allocation.
33. Une clôture est refusée uniquement si la somme des quantités traitées de toutes les allocations du batch est nulle (`Σ (producedQuantity + rejectedQuantity) = 0`).
34. Cette règle remplace toute mention précédente d'un prorata fondé uniquement sur les quantités conformes — y compris pour la répartition future du coût du mélange (Jalon 3, `BatchCost`), qui suit la même clé.

## Métadonnées de la feature

- ID : `PRD-11`
- Epic : 01 — Production
- Jalon cible : Jalon 2
- Statut : Architecture révisée et figée (2026-07-17) · Prête pour développement
