# PRD-11 — Revue d'architecture : Allocation multi-marchés

Voir `docs/adr/0006-allocation-marche-batch.md` pour la décision d'architecture formelle. Ce document détaille le raisonnement, les impacts sur le code existant, et l'état des conditions ayant précédé la validation finale.

## Résumé de la décision

Introduction de deux nouvelles entités (`Market`, `BatchMarketAllocation`) entre `Batch` et `Lot` : un batch peut désormais produire un lot par allocation de marché plutôt qu'un unique lot pour tout le batch. Le mélange (matières premières) reste calculé une seule fois pour tout le batch ; seuls le packaging, les rebuts, la quantité produite et le lot final sont propres à chaque allocation.

## Impacts détaillés sur les services existants

### `BatchPreparationService`
`computeIngredientQuantities()` doit être scindé conceptuellement en deux calculs :
- **Matière première** : inchangé dans son principe — un seul calcul, sur `Batch.plannedQuantity`, pour tout le batch (le mélange est commun).
- **Packaging** : doit désormais être calculé **par allocation**, à partir des lignes de packaging propres à chaque `BatchMarketAllocation` et de sa propre quantité, plutôt que sur les lignes de packaging de la `Recipe` du batch.

### `BatchFeasibilityService` (ADR 0005)
Le principe (double vérification lancement/clôture, jamais de divergence entre les deux) reste entièrement valide. Le périmètre du calcul s'élargit : le besoin en matière première reste vérifié une fois pour le batch, le besoin en packaging doit être agrégé sur l'ensemble des allocations avant de comparer au stock disponible.

### `BatchClosureService`
Impact le plus structurant : la clôture ne peut plus se faire en un seul geste avec une quantité produite/rebuts unique. Chaque allocation doit désormais fournir sa propre quantité produite et ses propres rebuts, et générer son propre lot avec sa propre généalogie. Le calcul du besoin en packaging (pour la vérification de stock à la clôture) doit être fait par allocation, comme pour `BatchFeasibilityService`.

### `LotNumberGeneratorService`
Aucun changement interne requis. Le service doit simplement être appelé une fois par allocation plutôt qu'une fois par batch — confirme la pertinence de l'avoir isolé dès l'origine (`docs/regles-metier.md` §4).

### Frontend (`ProductionPage.tsx`)
Impact réel mais non détaillé à ce stade (hors périmètre de cette revue, purement documentaire) : la saisie de fin de batch devra permettre de renseigner une quantité produite et des rebuts par allocation, plutôt qu'un seul couple de valeurs pour tout le batch. À traiter lors de l'analyse technique de mise en œuvre.

## Conditions initiales et leur résolution

Cette revue avait initialement identifié trois conditions bloquantes avant de considérer l'architecture comme validée. Toutes ont été tranchées par l'utilisateur le 2026-07-16 :

| Condition initiale | Résolution |
|---|---|
| Méthode de répartition proportionnelle de la généalogie (matière première) non tranchée | **Résolue** : répartition au prorata des volumes conformes de chaque allocation uniquement (rebuts exclus de cette clé) |
| Stratégie de migration des données historiques non tranchée | **Résolue** : aucun backfill, aucune modification rétroactive ; les anciens batchs restent mono-marché, sans allocation |
| Cohérence du champ dénormalisé `Lot.batchId` à documenter | **Résolue** : `Lot.batchId` conservé tel quel (inchangé, non-nullable), `Lot.allocationId` ajouté en complément (nouveau, nullable) — aucune migration requise, les deux champs coexistent |

Aucune condition bloquante ne subsiste : l'architecture est validée, la feature est prête pour développement (voir README.md).

## Points à traiter en phase de développement (non bloquants pour le cadrage)

- Détail de l'évolution de `ProductionPage.tsx` (saisie par allocation).
- Ordre exact d'introduction des nouveaux endpoints (création d'allocations, clôture par allocation) — à définir lors du plan de développement technique.
- Tests de non-régression à prévoir explicitement pour les batchs mono-marché (aucun changement de comportement attendu de leur point de vue) et pour la lecture des batchs/lots historiques (sans allocation).

## Risques identifiés

- **Risque de régression sur les batchs existants** si la nouvelle relation `Batch 1──n Lot` n'est pas traitée avec la même rigueur que l'actuelle `Batch 1──1 Lot` dans tout le code qui en dépend (ex. tout endroit lisant `batch.lot` en s'attendant à un singleton). À couvrir explicitement par des tests lors du développement.
- **Risque d'incohérence du champ dénormalisé `Lot.batchId`** si un futur développeur modifie l'allocation d'un lot sans repasser par la couche service dédiée — aucune contrainte base de données ne peut empêcher cela nativement.
