# PRD-11 — Spécification PO : Allocation multi-marchés

> **Avertissement** : ce document est la **première version officielle** de la spécification PO de `PRD-11`, rédigée et persistée dans le dépôt le 2026-07-16. Ce n'est **pas** la transcription d'une spécification antérieure — aucune spécification PO de cette feature n'existait dans le dépôt avant cette date. Ce document a été construit à partir des décisions métier validées humainement (voir `decisions-metier.md`), de l'avis d'architecture validé (`revue-architecture.md`, `docs/adr/0006-allocation-marche-batch.md`) et des arbitrages humains de cette session.

## Contexte

LCA-MES V0.9 gère aujourd'hui un batch de production comme une unité indivisible : une recette, une quantité, un lot fini en sortie. Le laboratoire a besoin de produire un même mélange pour plusieurs marchés (destination commerciale ou réglementaire, ex. France, Suisse) en une seule production, avec un packaging propre à chaque marché, tout en conservant un seul mélange commun.

Cette notion de "marché" est indépendante du site de production (LCA-MES reste mono-site, voir `MASTER_SPECIFICATION.md` §2 et §6).

## Objectif

Permettre à un batch de production d'être réparti entre plusieurs marchés, chaque marché recevant son propre lot fini avec son propre packaging, sans dupliquer le mélange.

## Comportement attendu

- Un batch peut contenir une ou plusieurs allocations de marché.
- Un même marché ne peut apparaître qu'une seule fois dans un même batch (une seule allocation par marché et par batch).
- Chaque allocation produit exactement un lot fini, avec son propre numéro de lot.
- Le mélange (recette, matières premières) est unique et commun à tout le batch — il n'est pas dupliqué ni recalculé par allocation.
- Le packaging (articles, quantités) peut être défini différemment pour chaque allocation.
- La répartition entre marchés (quantité prévue par allocation) est définie avant l'étape de conditionnement du batch.
- Les rebuts sont saisis et suivis indépendamment pour chaque allocation, pas globalement au niveau du batch.
- La quantité de packaging consommée par allocation se calcule sur sa quantité conforme **et** ses rebuts (règle déjà en vigueur pour les batchs mono-marché, inchangée).
- Le coût du mélange (une fois `BatchCost` construit, Jalon 3) est réparti entre allocations au prorata de leurs volumes conformes ; le coût du packaging est calculé directement par allocation.
- La généalogie du mélange commun est répartie entre les lots de chaque allocation au prorata des volumes conformes uniquement (les rebuts ne comptent pas dans cette clé de répartition).
- Les batchs déjà clôturés avant cette feature ne sont pas modifiés : ils restent mono-marché, sans allocation, lisibles exactement comme aujourd'hui.

## Périmètre explicitement exclu

- Gestion des commandes clients par marché.
- Expéditions / logistique transporteur par marché.
- Règles réglementaires détaillées par marché (étiquetage légal, notifications aux autorités, etc.).
- Toute notion de multi-site (indépendante de cette feature, non affectée).
- Migration ou reconstruction rétroactive des batchs/lots déjà clôturés.

## Critères d'acceptation

1. Un batch créé avec deux allocations de marché (ex. France + Suisse) produit exactement deux lots finis distincts, chacun avec son propre numéro de lot.
2. La création d'une seconde allocation pour un marché déjà présent dans le même batch est refusée.
3. Le mélange (quantités de matières premières) n'est calculé et vérifié qu'une seule fois pour l'ensemble du batch, quelle que soit le nombre d'allocations.
4. Deux allocations d'un même batch peuvent avoir des lignes de packaging différentes.
5. Les rebuts et la quantité produite sont saisis indépendamment pour chaque allocation à la clôture.
6. Un batch mono-marché (une seule allocation) continue de se comporter, du point de vue de l'utilisateur, comme un batch classique.
7. Un batch ou un lot créé avant cette feature reste consultable exactement comme avant, sans erreur, sans allocation associée.
8. Aucune commande, expédition ou règle réglementaire par marché n'est proposée dans l'interface.

## Documents associés

- `decisions-metier.md` — décisions métier validées, verbatim
- `revue-architecture.md` — analyse d'architecture et conditions d'approbation
- `docs/adr/0006-allocation-marche-batch.md` — décision d'architecture formelle
- `docs/modele-donnees.md` §4bis — modèle de données cible
