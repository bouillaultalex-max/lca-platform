# PRD-11 — Spécification PO : Allocation multi-marchés

> **Avertissement** : version révisée le 2026-07-17, avant toute implémentation (aucun code n'a été écrit sur la version du 2026-07-16). Voir `decisions-metier.md` (3ème à 5ème séries) et `docs/adr/0006-allocation-marche-batch.md` pour le détail complet de la revue d'architecture ayant conduit à cette révision.

## Contexte

LCA-MES V0.9 gère aujourd'hui un batch de production comme une unité indivisible : une recette, une quantité, un lot fini en sortie. Le laboratoire a besoin de produire un même mélange pour plusieurs sorties commerciales (par exemple un produit "classique" et sa déclinaison "label Suisse") en une seule production, chaque sortie recevant son propre packaging, tout en conservant un seul mélange commun.

Le catalogue distingue déjà ces déclinaisons comme des produits finis à part entière. La notion de "marché" (destination commerciale ou réglementaire, ex. France, Suisse) est indépendante du site de production (LCA-MES reste mono-site, voir `MASTER_SPECIFICATION.md` §2 et §6).

## Objectif

Permettre à un batch de production de générer plusieurs sorties commerciales distinctes, chacune avec son propre packaging (dérivé de sa recette) et son propre lot fini, sans dupliquer le mélange commun, et sans jamais demander à l'utilisateur de choisir une recette ou d'associer manuellement un produit à un marché.

## Comportement attendu

- Un batch représente un run physique unique autour d'**un seul mélange commun**. Il produit une ou plusieurs sorties commerciales (`BatchProductAllocation`).
- **Cas standard (produit sans déclinaison commerciale)** : le comportement est strictement identique à aujourd'hui — l'utilisateur choisit une recette, une machine, une quantité. Le système crée automatiquement une allocation unique, sans aucune saisie supplémentaire.
- **Cas d'un produit appartenant à une famille commerciale** (`ProductFamily`) : pour ajouter une sortie supplémentaire, l'utilisateur choisit uniquement un **marché** parmi ceux réellement déclinés pour ce produit — le produit fini et sa recette sont résolus automatiquement depuis le catalogue. L'utilisateur ne choisit jamais une recette, et ne choisit un produit directement que si celui-ci n'appartient à aucune famille commerciale.
- Un même produit ou un même marché ne peut apparaître qu'une seule fois dans un même batch.
- Chaque allocation produit exactement un lot fini, avec son propre numéro de lot.
- Le mélange (recette, matières premières) est unique et commun à tout le batch — calculé et vérifié une seule fois, quel que soit le nombre d'allocations.
- Le packaging de chaque allocation est **dérivé automatiquement** de la recette de son produit fini — jamais saisi librement dans le batch.
- Toute recette d'allocation doit avoir une composition matière première strictement identique à la recette de référence du batch (même articles, mêmes quantités par unité, même format) — sinon la création de l'allocation est bloquée avec un message explicite indiquant la divergence.
- La répartition entre allocations (quantité prévue par allocation) est définie avant l'étape de conditionnement du batch.
- Les rebuts sont saisis et suivis indépendamment pour chaque allocation, pas globalement au niveau du batch — les agrégats du batch (`plannedQuantity`/`producedQuantity`/`rejectedQuantity`) restent la somme des allocations, vérifiée à chaque écriture.
- La quantité de packaging consommée par allocation se calcule sur sa quantité conforme **et** ses rebuts (règle déjà en vigueur, inchangée).
- Le coût du mélange (une fois `BatchCost` construit, Jalon 3) sera réparti entre allocations selon la même clé que la généalogie (quantité traitée) ; le coût du packaging sera calculé directement par allocation.
- La généalogie du mélange commun est répartie entre les lots de chaque allocation au prorata de leur **quantité traitée** (`producedQuantity + rejectedQuantity`) — les rebuts consomment réellement le mélange et reçoivent donc leur part de généalogie, contrairement à la version initiale du 2026-07-16 qui excluait les rebuts de cette clé. Le reliquat d'arrondi est affecté déterministement à la dernière allocation. Une clôture est refusée uniquement si la somme des quantités traitées de toutes les allocations du batch est nulle.
- Les batchs déjà clôturés avant cette feature ne sont pas modifiés : ils restent sans allocation, lisibles exactement comme aujourd'hui.

## Nouveau référentiel : familles commerciales

- Une **famille commerciale** (`ProductFamily`) regroupe les déclinaisons d'un même produit par marché (ex. "Recharge Lavande" → déclinaison France, déclinaison Suisse).
- Un produit fini peut appartenir à au plus une famille, pour au plus un marché — le catalogue garantit qu'il n'existe jamais deux produits pour le même marché dans une même famille.
- Cette association est gérée dans le catalogue (hors périmètre de l'écran de production) — elle n'est jamais saisie ni modifiée lors de la création d'un batch.

## Périmètre explicitement exclu

- Gestion des commandes clients par marché.
- Expéditions / logistique transporteur par marché.
- Règles réglementaires détaillées par marché (étiquetage légal, notifications aux autorités, etc.).
- Toute notion de multi-site (indépendante de cette feature, non affectée).
- Migration ou reconstruction rétroactive des batchs/lots déjà clôturés.
- Fusion avec la future notion de "gamme" pour la planification (DEBT-05) — `ProductFamily` reste un concept distinct.

## Critères d'acceptation

1. Un batch créé sur un produit standard (sans famille commerciale) se comporte exactement comme aujourd'hui, sans aucune saisie supplémentaire.
2. Un batch avec deux allocations (ex. France + Suisse) produit exactement deux lots finis distincts, chacun avec son propre numéro de lot, sans que l'utilisateur ait choisi de recette pour la seconde allocation.
3. La création d'une seconde allocation pour un marché déjà présent dans le même batch est refusée ; de même pour un produit déjà présent.
4. Le mélange (quantités de matières premières) n'est calculé et vérifié qu'une seule fois pour l'ensemble du batch, quel que soit le nombre d'allocations.
5. L'ajout d'une allocation dont la recette a une composition matière première différente de la recette de référence est refusé, avec un message indiquant explicitement la divergence.
6. Deux allocations d'un même batch ont un packaging différent dès lors que leurs produits finis ont des recettes de packaging différentes — sans aucune saisie manuelle de packaging dans le batch.
7. Les rebuts et la quantité produite sont saisis indépendamment pour chaque allocation à la clôture ; la somme des allocations doit correspondre aux agrégats du batch.
8. Un batch ou un lot créé avant cette feature reste consultable exactement comme avant, sans erreur, sans allocation associée.
9. Aucune commande, expédition ou règle réglementaire par marché n'est proposée dans l'interface.

## Documents associés

- `decisions-metier.md` — décisions métier validées, verbatim, y compris la révision architecturale du 2026-07-17
- `revue-architecture.md` — analyse d'architecture et conditions d'approbation
- `plan-developpement.md` — plan technique détaillé, étape par étape
- `docs/adr/0006-allocation-marche-batch.md` — décision d'architecture formelle (révisée)
- `docs/modele-donnees.md` §1bis, §4bis — modèle de données cible
