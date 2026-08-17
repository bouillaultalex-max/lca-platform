# ADR 0007 — Coût par flacon (`BatchCost`)

## Statut

Accepté — 2026-08-11. Revue d'architecture PRD-10 conclue **« Approuvé sous conditions »**, 5 conditions posées puis validées humainement le même jour (voir § Décisions ci-dessous) — aucun code écrit avant cette validation.

## Contexte

Le livrable du Jalon 3 (`docs/roadmap.md`) est explicite : *« chaque lot est intégralement traçable (généalogie), contrôlé qualité, et son coût par flacon est calculé et figé »*. Les deux premiers volets (traçabilité, module `traceability`) sont terminés et vérifiés (PRD-07 à PRD-09, TRAC-01 à TRAC-04, `PROJECT_STATE.md`). PRD-10 (`Calcul et historisation du coût par flacon`, `MASTER_BACKLOG.md`, Epic 01 — Production) couvre le troisième volet et reste, à ce jour, non démarré.

La règle métier de fond existe déjà et n'est pas remise en cause par cet ADR — elle est **confirmée depuis le 2026-07-05** (`docs/regles-metier.md` §5, `MASTER_SPECIFICATION.md` §4.7) :
- le coût par flacon est calculé à partir des **coûts unitaires courants des articles** de la recette au moment de la clôture du batch, puis **figé définitivement** (une évolution ultérieure de `Article.currentUnitCost` n'affecte jamais un coût déjà calculé) ;
- le coût unitaire se calcule en divisant le coût total (matière première + packaging) par la **quantité totale produite, rebuts inclus**.

Ce qui restait à trancher, et qui fait l'objet de cet ADR, c'est comment cette règle s'articule avec deux évolutions survenues depuis qu'elle a été énoncée :

1. **PRD-11 / `BatchProductAllocation`** (ADR 0006, implémenté le 2026-07-22) : un batch peut désormais produire plusieurs lots (un par allocation), chacun avec son propre packaging et sa propre quantité traitée. `docs/modele-donnees.md` §4bis note déjà, en attente de cet ADR : *« Coût (Jalon 3, `BatchCost`, non encore construit) : coût du mélange réparti proportionnellement entre allocations (même clé que la généalogie), coût du packaging calculé directement par allocation »*. `docs/modele-donnees.md` §7 et §11 documentaient quant à eux un `BatchCost` provisoire rattaché au `Batch` (`Batch 1──1 BatchCost`) — placeholder antérieur à PRD-11, désormais corrigé pour refléter `Lot 1──1 BatchCost` (voir § Conséquences).
2. **FIFO vs prix** : `StockFifoService`/`computeFifoAllocations` détermine déjà, à la clôture, quels `StockLot` précis sont consommés et en quelle quantité (généalogie, `docs/regles-metier.md` §2). Aucun champ de coût n'existe sur `StockLot`. La question posée pendant la revue d'architecture était de savoir si le prix devait suivre cette même logique FIFO (coût pondéré par lot de réception consommé) ou rester fondé sur `Article.currentUnitCost` comme le prévoyait déjà la règle du 2026-07-05. Cette question a été tranchée explicitement par l'utilisateur (voir § Décisions, point 2) : **le FIFO détermine les quantités et les lots réellement consommés, mais ne détermine pas le prix**.

Cet ADR documente les décisions retenues pour ces deux points, le modèle de données qui en résulte et le principe d'intégration dans `BatchClosureService` — sans introduire de code, de migration Prisma, ni de nouveau périmètre métier au-delà de ce qui a été validé.

## Décisions

Cinq conditions posées par la revue d'architecture (`alex-architecte`) et validées humainement le 2026-08-11, complétées par la règle fondamentale FIFO/prix et le périmètre de la tranche :

1. **Coût = matière première + packaging uniquement**, aucun autre poste en V0.9 (pas de main d'œuvre, pas d'amortissement machine) — inchangé par rapport à la règle du 2026-07-05.
2. **Prix basé sur `Article.currentUnitCost` au moment de la clôture. Aucun coût pondéré par `StockLot`/FIFO.** Le FIFO détermine les quantités et les lots réellement consommés (généalogie, déduction de stock), mais ne détermine jamais le prix.
3. **`currentUnitCost` exprimé selon l'unité de mesure de l'article** (ex. €/L pour une matière première liquide, €/kg, €/unité pour du packaging) — aucune conversion d'unité implicite ; le coût matière première et le coût packaging sont chacun calculés dans l'unité native de l'article concerné, puis simplement additionnés en montant (les unités de mesure ne se combinent pas, seuls les montants s'additionnent).
4. **`BatchCost` rattaché à `Lot` en relation `1──1`** (et non à `Batch`) — corrige le placeholder actuel de `docs/modele-donnees.md` §7/§11 (`Batch 1──1 BatchCost`), devenu obsolète depuis PRD-11 (voir § Raisons du choix).
5. **`BatchCost` totalement immuable en V0.9** : aucun endpoint de recalcul, aucun endpoint de correction. Une fois calculé à la clôture, un `BatchCost` ne change plus jamais.
6. **Lecture ouverte à `DIRECTION`/`DAF`** — cohérent avec leur accès en lecture seule déjà existant aux coûts, stocks et tableaux de bord (`CLAUDE.md`, `MASTER_SPECIFICATION.md` §2).
7. **Backend uniquement pour cette tranche** — aucun écran frontend dans le périmètre de ce ticket ; `BatchCost` est calculé et consultable via API, l'exposition dans une interface reste un ticket distinct, non cadré ici.
8. **Aucun `siteId` propre sur `BatchCost`** : le cloisonnement par site reste porté exclusivement par `lot.siteId`, jamais dupliqué sur `BatchCost`. Vérifié cohérent avec le code déjà en place (voir § Raisons du choix) — décision explicitement tranchée, pas un point ouvert.

## Raisons du choix

**Pourquoi un `BatchCost` par `Lot` et non par `Batch`** : depuis PRD-11 (ADR 0006), un batch peut produire plusieurs lots distincts (un par `BatchProductAllocation`), chacun avec son propre packaging (donc son propre coût packaging) et sa propre quantité traitée (donc son propre coût unitaire). Un `BatchCost` unique par `Batch` ne pourrait représenter qu'une moyenne agrégée, ce qui reviendrait à masquer les différences réelles de coût entre deux sorties commerciales d'un même run (ex. un produit "classique" et sa déclinaison "label Suisse", packaging différent). Rattacher `BatchCost` à `Lot` en `1──1` reste par ailleurs cohérent avec la relation déjà existante `BatchProductAllocation 1──1 Lot` (ADR 0006, décision 5) : pour un batch à allocation unique (cas standard), cela reste dans les faits un coût par batch, sans introduire de branchement mono/multi-allocation supplémentaire dans le code — même principe de chemin de traitement unique déjà retenu par ADR 0006 pour `BatchClosureService`.

**Pourquoi `Article.currentUnitCost` et non un coût pondéré FIFO/`StockLot`** : c'est la règle déjà confirmée le 2026-07-05 (`docs/regles-metier.md` §5), antérieure à toute discussion FIFO — cet ADR ne fait que la réaffirmer explicitement face à la question soulevée pendant la revue. Un coût pondéré par `StockLot` nécessiterait d'ajouter un champ de coût à `StockLot` (impact sur le modèle de données au-delà de ce qui a été validé) et rendrait le coût figé dépendant de l'ordre de réception des lots plutôt que d'une valeur de référence unique et auditable par article — moins lisible pour `DIRECTION`/`DAF`, qui consultent un coût pour piloter, pas pour auditer un historique d'approvisionnement. La séparation quantité (FIFO) / prix (`currentUnitCost`) est cohérente avec le fait que `StockFifoService` est aujourd'hui une fonction pure de comparaison stock/besoin, sans aucune notion de prix.

**Pourquoi figé et immuable dès la V0.9** : prolonge directement la règle déjà actée (« figé définitivement ») et le principe déjà appliqué à `Lot`/`LotGenealogy`/`StockMovement`, tous immuables une fois la clôture transactionnelle passée (`BatchClosureService`). Un endpoint de recalcul introduirait une question non triviale (recalcul sur quelle base ? quel impact sur un historique déjà consulté par `DIRECTION`/`DAF` ?) hors du périmètre validé pour cette tranche.

**Pourquoi pas de `siteId` propre sur `BatchCost`** : vérifié dans `apps/api/prisma/schema.prisma` — le cloisonnement par site n'est pas appliqué uniformément à toutes les tables ; il l'est sur les entités interrogées directement et de façon autonome (`Article`, `StockLot`, `StockItem`, `StockMovement`, `Batch`, `Lot`, toutes avec leur propre colonne `siteId`), mais **pas** sur les entités enfants toujours accédées via leur parent : `LotGenealogy` (enfant de `Lot`, `lotId` uniquement, aucun `siteId`) et `BatchStop` (enfant de `Batch`, `batchId` uniquement, aucun `siteId`) — deux modèles réels, déjà implémentés, vérifiés dans le schéma. Le code confirme ce même principe côté service : il n'existe aucun middleware Prisma global de filtrage par site (vérifié dans `apps/api/src/prisma/`) — le cloisonnement est appliqué manuellement, service par service, en filtrant l'entité racine de la requête par `siteId` (ex. `TraceabilityService.findLotTraceability` filtre `Lot` par `{ id, siteId }` puis inclut `genealogyLines` sans filtre supplémentaire, `docs/regles-metier.md` §2/§10). `BatchCost` a exactement la même forme structurelle que `LotGenealogy` : entité enfant en relation stricte avec `Lot` (ici `1──1` plutôt que `1──n`), jamais interrogée indépendamment de son lot. Dupliquer `siteId` sur `BatchCost` introduirait une deuxième source de vérité pour une information déjà garantie par la relation vers `Lot`, sans bénéfice — aucune requête métier plausible ne nécessite de lister des `BatchCost` sans passer par leur `Lot` (et donc par `lot.siteId`).

## Modèle de données retenu

Champs validés par la revue d'architecture pour `BatchCost` (aucun modèle Prisma créé par cet ADR — à formaliser dans une migration additive ultérieure) :

- `lot` → FK `Lot`, **contrainte d'unicité** (relation `1──1`, remplace le rattachement à `Batch` documenté jusqu'ici).
- `batchId` → FK `Batch`, **dénormalisé depuis `lot.batchId`** — ne remplace pas `lotId` et ne constitue pas la clé de cloisonnement (le site reste dérivé de `Lot.siteId`, voir décision 8 ci-dessus). Conservé pour permettre une recherche directe par batch et préserver le rattachement explicite au `Batch` d'origine, cohérent avec la dénormalisation déjà en place sur `Lot.batchId` (lui-même dénormalisé depuis `allocation.batchId`, voir ADR 0006). Indexé (`@@index([batchId])`) pour que cet usage reste performant.
- `materialCostTotal` — coût matière première total pour ce lot, calculé à partir des lignes de généalogie matière première déjà proratisées par allocation à la clôture (`producedQuantity + rejectedQuantity`, ADR 0006 décision 20) et de `Article.currentUnitCost` de chaque article consommé.
- `packagingCostTotal` — coût packaging total pour ce lot, calculé directement par allocation (déjà le principe retenu par ADR 0006 décision 9) à partir de `Article.currentUnitCost` de chaque article de packaging consommé.
- `unitCost` — coût unitaire par flacon = (`materialCostTotal` + `packagingCostTotal`) ÷ quantité totale traitée du lot (`producedQuantity + rejectedQuantity` de l'allocation correspondante, cohérent avec `docs/regles-metier.md` §5).
- `calculatedAt` — horodatage de la clôture (moment où `Article.currentUnitCost` a été lu et figé).

Aucun champ `siteId` propre : suit la même convention que `LotGenealogy` (enfant de `Lot`) et `BatchStop` (enfant de `Batch`) — deux entités enfants réelles du schéma actuel, sans `siteId` propre, le cloisonnement restant porté par leur parent. Voir § Raisons du choix pour la vérification détaillée. (`QualityCheck`, mentionné à titre prospectif dans `docs/modele-donnees.md` §6, n'existe pas encore dans `schema.prisma` — non retenu ici comme précédent, faute d'implémentation vérifiable.)

`docs/modele-donnees.md` §7 (description narrative de `BatchCost`) et §11 (schéma relationnel) ont depuis été corrigés pour refléter `Lot 1──1 BatchCost` — voir § Conséquences.

## Intégration avec `BatchClosureService`

Principe d'intégration, sans modification de code à ce stade : `BatchClosureService` calcule déjà, dans sa transaction unique de clôture, les lignes de généalogie matière première proratisées par allocation (étape décrite dans `docs/modele-donnees.md` §5, ADR 0006 décision 20) et la consommation de packaging par allocation (ADR 0006 décision 9). Le calcul de `BatchCost` s'insère comme une **étape supplémentaire de cette même transaction**, après que les quantités consommées par lot sont connues et avant sa validation finale :

1. pour chaque lot créé dans la transaction, lire `Article.currentUnitCost` de chaque article de matière première et de packaging effectivement consommé (déjà identifiés par les lignes de généalogie/consommation calculées à cette étape) ;
2. valoriser chaque quantité consommée à ce coût unitaire courant, dans l'unité de mesure native de l'article (décision 3) ;
3. sommer pour obtenir `materialCostTotal` et `packagingCostTotal` du lot ;
4. diviser par la quantité totale traitée du lot pour obtenir `unitCost` ;
5. écrire le `BatchCost` du lot dans la même transaction Prisma que la création du `Lot`, de sa généalogie et des `StockMovement` — une rupture ou une erreur à cette étape annule l'ensemble de la clôture, exactement comme pour une rupture de stock aujourd'hui (aucune écriture partielle).

Aucune lecture de `StockLot` ni de coût par lot de réception n'intervient dans ce calcul : les lignes de généalogie servent uniquement à identifier quels articles et quelles quantités ont été consommés (le FIFO a déjà fait ce travail), jamais à en dériver un prix.

## Conséquences

- **Migration Prisma additive requise** (non réalisée par cet ADR) : nouvelle table `BatchCost` rattachée à `Lot` (`1──1`, contrainte d'unicité sur `lotId`). Aucun impact sur les tables existantes.
- **Aucun backfill** : les lots déjà clôturés avant l'implémentation de PRD-10 n'auront jamais de `BatchCost` rétroactif — cohérent avec le principe déjà retenu pour PRD-11 (ADR 0006, décision 12, aucune modification rétroactive des données historiques).
- **Coût historique figé** : une fois calculé, un `BatchCost` reste exact même si `Article.currentUnitCost` évolue ensuite — c'est la garantie déjà donnée par la règle du 2026-07-05, désormais rendue structurelle par l'immutabilité du modèle (décision 5).
- **Aucun recalcul en V0.9** : ni automatique, ni via un endpoint dédié. Une correction éventuelle d'un coût déjà figé (ex. erreur constatée après coup) reste hors périmètre de cette tranche — à cadrer explicitement si le besoin se présente.
- **Consultation possible par `DIRECTION`/`DAF`** dès l'implémentation, sans écran dédié dans cette tranche (décision 7) — un endpoint de lecture suffit pour honorer la décision 6 ; l'écran de consultation reste un ticket frontend distinct.
- **`docs/modele-donnees.md` §7 et §11 ont été corrigés** pour refléter `Lot 1──1 BatchCost` (et non `Batch 1──1 BatchCost`).
- Si un futur ticket introduit un poste de coût supplémentaire (main d'œuvre, amortissement machine — explicitement hors périmètre V0.9), la structure `BatchCost` par lot reste le point d'extension naturel, sans nécessiter de refonte de son rattachement.

## Alternatives envisagées et écartées

- **Coût pondéré par `StockLot`/FIFO** (valoriser chaque quantité consommée au coût du `StockLot` de réception précis d'où elle provient) : écarté — contredit la règle métier déjà confirmée le 2026-07-05 (`Article.currentUnitCost`, pas un coût par lot de réception) ; nécessiterait d'ajouter un champ de coût à `StockLot`, absent du modèle actuel ; rendrait le coût figé dépendant de l'ordre FIFO de consommation plutôt que d'une valeur de référence unique par article. Tranché explicitement par l'utilisateur : le FIFO détermine les quantités, jamais le prix.
- **`BatchCost` unique par `Batch`** (plutôt que par `Lot`) : écarté — insuffisant depuis PRD-11, où un batch peut produire plusieurs lots à packaging et quantités distincts ; un coût unique masquerait les différences réelles entre allocations et contredirait le principe déjà retenu par ADR 0006 (chemin de traitement unique, pas de distinction mono/multi-allocation dans le code, mais bien un lot — et donc un coût — par allocation).
- **Recalcul dynamique après clôture** (endpoint de correction ou recalcul automatique si `Article.currentUnitCost` change) : écarté pour la V0.9 — contredit directement la règle de figeage définitif déjà confirmée (§5) et introduirait une question de gouvernance non cadrée (qui peut déclencher un recalcul, sur quelle base, avec quel impact sur un historique déjà consulté par `DIRECTION`/`DAF`). Resterait un chantier distinct, à cadrer explicitement si un besoin réel apparaît.

## Risques connus

Deux constats déjà identifiés sur `BatchClosureService` avant cet ADR, non résolus, non transformés en tâche ici — mentionnés car le calcul de `BatchCost` s'insère dans la même transaction et hérite donc de la même surface de risque :

- **Collision de `Lot.lotNumber`** : `LotNumberGeneratorService` reste un compteur séquentiel provisoire (voir `docs/modele-donnees.md` §5, DEBT-01) dont le code admet lui-même ne pas gérer la concurrence ; une collision provoquerait une erreur Prisma `P2002` non interceptée aujourd'hui. Un `BatchCost` ne peut exister sans son `Lot` (relation `1──1`) : cette dépendance n'aggrave pas le risque existant mais n'y apporte aucune atténuation non plus.
- **Absence de garde-fou sur le stock en écriture concurrente** : aucune contrainte `CHECK` sur `StockItem.availableQuantity`/`StockLot.remainingQuantity`, aucun niveau d'isolation transactionnelle élevé — un risque de stock négatif déjà identifié, indépendant de PRD-10. Le calcul de `BatchCost` ne lit que `Article.currentUnitCost` (pas de quantité de stock disponible), il n'introduit donc pas de nouvelle exposition à ce risque, mais reste dans la même transaction que les écritures qui y sont exposées.

Ces deux constats restent des risques existants et non validés comme tâches — leur traitement éventuel reste à cadrer séparément avec l'utilisateur, comme précédemment.

## Références

- `docs/regles-metier.md` §5 (Coût par flacon — décision confirmée le 2026-07-05).
- `docs/modele-donnees.md` §4bis (note sur `BatchCost`, PRD-11), §5 (généalogie et proratisation par allocation), §7 (`BatchCost`), §11 (schéma relationnel).
- `MASTER_SPECIFICATION.md` §4.7 (Coûts).
- `docs/roadmap.md` — Jalon 3, livrable « coût par flacon calculé et figé ».
- `MASTER_BACKLOG.md` — PRD-10 (Epic 01, Production).
- `docs/adr/0006-allocation-marche-batch.md` — `BatchProductAllocation`, relation `1──1` avec `Lot`, proratisation de la généalogie par quantité traitée (décision 20), principe de chemin de traitement unique dans `BatchClosureService`.
- `docs/adr/0005-faisabilite-lancement-batch.md` — précédent le plus proche de réutilisation d'une brique de calcul déjà existante (`computeFifoAllocations`) sans la modifier ni la dupliquer, même logique de prudence appliquée ici à `Article.currentUnitCost`.
- `apps/api/src/production/batch-closure/batch-closure.service.ts` — point d'intégration transactionnel décrit en § Intégration.
- `apps/api/src/stock/stock-fifo/stock-fifo.service.ts` — confirme l'absence de tout champ de coût sur `StockLot`/`FifoAllocation`.
