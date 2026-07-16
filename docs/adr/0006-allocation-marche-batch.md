# ADR 0006 — Allocation marché ↔ batch

## Statut

Accepté — 2026-07-16

## Contexte

Retour métier validé humainement (feature `PRD-11`, voir `docs/features/PRD-11-allocation-multi-marches/`) : un batch de production doit pouvoir être réparti entre plusieurs marchés (destination commerciale ou réglementaire, ex. France, Suisse), chaque marché recevant son propre lot fini avec un packaging potentiellement différent, tout en partageant le même mélange (recette, matières premières).

Cette notion de "marché" est **indépendante du multi-site** : LCA-MES reste mono-site en V0.9 (`siteId` continue de désigner le site de production physique, voir ADR 0001 §8) ; un marché est une destination commerciale/réglementaire du produit fini, pas un lieu de production.

Décisions métier validées avec l'utilisateur (2026-07-16) :
1. Un batch peut contenir plusieurs allocations de marché.
2. Une seule allocation par marché dans un même batch.
3. Une allocation génère exactement un lot fini.
4. Le mélange et la recette sont communs à tout le batch.
5. Le packaging peut différer selon le marché.
6. La répartition entre marchés est définie avant le conditionnement.
7. Les rebuts sont suivis par allocation.
8. Les consommations de packaging sont calculées sur conforme + rebuts (par allocation).
9. Le coût du mélange sera réparti proportionnellement entre allocations ; le packaging sera calculé directement par allocation.
10. Commandes, expéditions et règles réglementaires détaillées par marché sont hors périmètre.

Arbitrages complémentaires validés le 2026-07-16 :
11. La généalogie du mélange commun est répartie entre allocations **au prorata des volumes conformes uniquement** (rebuts exclus de cette clé de répartition).
12. **Aucun backfill ni modification rétroactive des données historiques** : les batchs déjà clôturés restent tels quels.
13. Les anciens batchs restent mono-marché (relation directe `Lot.batch`, sans allocation).
14. `StockMovement` reçoit un `batchMarketAllocationId` nullable.

## Décision

1. **Nouvelle entité `Market`** (référentiel simple : code, libellé, actif) — un marché est une entité dédiée, pas un texte libre, cohérent avec les entités `Supplier`/`Machine` déjà existantes dans le catalogue.
2. **Nouvelle entité `BatchMarketAllocation`**, enfant de `Batch` :
   - `batchId` → FK `Batch`
   - `marketId` → FK `Market`
   - contrainte d'unicité `(batchId, marketId)` — une seule allocation par marché et par batch (décision 2)
   - `plannedQuantity` — quantité prévue pour cette allocation ; la somme des `plannedQuantity` de toutes les allocations d'un batch doit égaler `Batch.plannedQuantity` (invariant vérifié, pas un champ dupliqué)
   - `producedQuantity`, `rejectedQuantity` — saisis par allocation, pas au niveau du batch global (décision 7)
   - lignes de packaging propres à l'allocation (décision 5) — le mélange (matières premières) reste porté par la `Recipe` du batch, commune à toutes les allocations (décision 4)
3. **`Lot` rattaché à une allocation, `Lot.batchId` conservé** :
   - `Lot.allocationId` (nouveau, **nullable**) → FK `BatchMarketAllocation`, relation `BatchMarketAllocation 1──1 Lot`. Renseigné pour tout lot généré via cette feature.
   - `Lot.batchId` (existant, **inchangé, non-nullable**) → FK `Batch`, conservé pour les lectures et la traçabilité (éviter une jointure systématique via l'allocation pour "tous les lots d'un batch"). Pour un nouveau lot avec allocation, ce champ est dénormalisé/dérivé de `allocation.batchId`, maintenu par la couche service, jamais modifiable indépendamment de l'allocation.
   - Pour les lots antérieurs à cette feature, `Lot.allocationId` reste `null` et `Lot.batchId` est l'unique rattachement, exactement comme aujourd'hui — **aucune migration de données requise** (décision 12).
   - `Batch 1──n Lot` de fait (via les allocations), remplaçant `Batch 1──1 Lot` pour tout batch créé après cette feature.
4. **`BatchPreparationService.computeIngredientQuantities()` scindé en deux calculs** :
   - besoin en matières premières (volume + masse), calculé **une fois pour tout le batch** à partir de `Batch.plannedQuantity` — inchangé dans son principe (décision 4) ;
   - besoin en packaging, calculé **par allocation**, à partir de ses propres lignes de packaging et de sa propre quantité.
5. **`BatchFeasibilityService` (ADR 0005) et `BatchClosureService` adaptés** pour agréger les besoins packaging de toutes les allocations en plus du besoin matière première unique du batch, sans changer le principe déjà acté (vérification unique côté serveur, réutilisée entre lancement et clôture — ADR 0005 reste valide, seul le périmètre du calcul s'élargit).
6. **`LotNumberGeneratorService` appelé une fois par allocation** à la clôture (au lieu d'une fois par batch) — le service lui-même n'est pas modifié, conforme à sa conception déjà isolée (`docs/regles-metier.md` §4).
7. **Répartition de la généalogie du mélange commun** : les lignes `LotGenealogy` liées aux matières premières (mélange commun) sont réparties entre les lots de chaque allocation **au prorata des volumes conformes de chaque allocation uniquement** — les rebuts ne participent pas à cette clé de répartition (décision 11). Les lignes de packaging, elles, restent directement rattachées au lot de l'allocation concernée et calculées sur conforme + rebuts (décision 8, inchangée).
8. **`StockMovement.batchMarketAllocationId`** (nouveau, nullable) → FK `BatchMarketAllocation` : renseigné pour une sortie de packaging propre à une allocation, laissé vide pour une sortie de matière première (mélange commun, non ventilé par allocation) (décision 14).
9. **Coût (`BatchCost`, Jalon 3, pas encore construit — PRD-10)** : contrainte actée pour sa conception future, pas un changement de code aujourd'hui — répartition proportionnelle du coût du mélange entre allocations (même clé que la généalogie, décision 11), calcul direct du coût de packaging par allocation (décision 9).
10. **Aucun backfill, aucune migration rétroactive** : les batchs et lots déjà clôturés avant cette feature ne sont ni modifiés, ni complétés avec une allocation implicite. Ils restent lisibles exactement comme aujourd'hui via `Lot.batchId` (décisions 12 et 13).

## Alternatives envisagées et écartées

- **Un batch = un marché (dupliquer le batch entier par marché)** : écarté — recréerait un mélange identique pour chaque marché (gaspillage de matière, contradiction directe avec la décision 4 "le mélange et la recette sont communs"), et contredit la décision 1 ("un batch peut contenir plusieurs allocations").
- **Rattacher le marché à `RecipeLine` directement** : écarté — une recette reste une définition de composition indépendante du marché ; le marché est une propriété du batch/de l'allocation, pas de la recette elle-même.
- **Réutiliser `siteId` pour porter la notion de marché** : écarté explicitement par l'utilisateur — le multi-marché ne signifie pas multi-site, ce sont deux axes orthogonaux.
- **Remplacer `Lot.batchId` par `Lot.allocationId` sans conserver le premier** : écarté — aurait nécessité soit une migration rétroactive de toutes les données historiques (contredit la décision 12), soit une relation optionnelle incohérente pour les anciens lots. Conserver les deux champs (l'un stable et historique, l'autre nouveau et propre à cette feature) évite toute migration.
- **Backfill d'une allocation "par défaut" pour les batchs déjà clôturés** : écarté explicitement par l'utilisateur — aucune modification rétroactive des données historiques ; les anciens batchs restent mono-marché sans allocation.
- **Répartir la généalogie du mélange au prorata de la quantité prévue (plutôt que conforme)** : écarté — la quantité réellement conforme par allocation n'est connue qu'à la clôture, et c'est elle qui doit gouverner la répartition d'un mélange réellement consommé, pas une prévision.

## Conséquences

- Impact structurant sur le modèle de données (`Batch`, `Lot`, `StockMovement`, nouvelles entités `Market` et `BatchMarketAllocation`) — détaillé dans `docs/modele-donnees.md` §4bis et §5.
- Impact sur trois services déjà existants (`BatchPreparationService`, `BatchFeasibilityService`, `BatchClosureService`) et sur le frontend `ProductionPage.tsx` (saisie de rebuts/quantité produite désormais par allocation, pas globale) — aucun n'est modifié à ce stade, seul le principe est acté ici ; le détail de mise en œuvre reste à faire lors de l'analyse technique (voir `docs/modele-donnees.md` §12).
- `LotNumberGeneratorService` n'a besoin d'aucune modification interne, seulement d'être appelé plusieurs fois — confirme la pertinence du choix initial de l'isoler (`docs/regles-metier.md` §4).
- Le calcul de faisabilité (ADR 0005) reste valide dans son principe (double vérification lancement/clôture, jamais de divergence) mais son périmètre de calcul doit s'étendre au niveau allocation pour le packaging.
- **Aucune migration de données requise** : la coexistence de `Lot.batchId` (toujours renseigné) et `Lot.allocationId` (nullable, nouveau) permet aux données historiques de rester inchangées tout en introduisant le nouveau modèle pour les batchs futurs.
- Si un futur écran nécessite un contrôle similaire "aperçu avant action irréversible, revérifié indépendamment à l'exécution réelle" (ex. futur module `planning`), le même patron (endpoint de consultation + revérification serveur au moment de l'écriture) pourra être réutilisé — déjà observé avec les imports OpenSi et l'ADR 0005.
