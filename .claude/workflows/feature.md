---
name: feature-workflow
version: 1
---

# Workflow Feature LCA-MES

## Objectif

Encadrer le traitement complet d’une nouvelle fonctionnalité depuis la demande initiale jusqu’au rapport final.

## Livrables obligatoires

Chaque fonctionnalité possède un dossier :

`.claude/reports/features/YYYY-MM-DD-nom-court/`

Ce dossier contient :

1. `00-demande.md`
2. `01-specification-po.md`
3. `02-revue-architecture.md`
4. `03-plan-developpement.md`
5. `04-rapport-qa.md`
6. `05-rapport-documentation.md`
7. `06-rapport-final.md`

## Étape 1 — Demande

Responsable : utilisateur humain.

La demande doit contenir :

- le besoin ;
- les utilisateurs concernés ;
- les décisions déjà prises ;
- les contraintes ;
- le périmètre exclu.

## Étape 2 — Product Owner

Responsable : `alex-po`.

Entrée :

- `00-demande.md`
- documentation du projet ;
- code concerné.

Sortie :

- `01-specification-po.md`

Verdict requis :

- PRÊT POUR VALIDATION HUMAINE
- BLOQUÉ — INFORMATIONS MANQUANTES
- HORS PÉRIMÈTRE ACTUEL

Aucun fichier applicatif ne doit être modifié.

## Étape 3 — Architecture

Responsable : `alex-architecte`.

Entrée :

- `00-demande.md`
- `01-specification-po.md`
- documentation, ADR et code concernés.

Sortie :

- `02-revue-architecture.md`

Décision requise :

- APPROUVÉ
- APPROUVÉ SOUS CONDITIONS
- REFUSÉ
- BLOQUÉ — INFORMATIONS MANQUANTES

Aucun fichier applicatif ne doit être modifié.

## Étape 4 — Validation humaine

Le développement ne commence qu’après :

- validation de la spécification ;
- validation architecturale ;
- résolution des conditions obligatoires ;
- autorisation explicite de développement.

## Étape 5 — Plan de développement

Le plan doit être enregistré dans :

`03-plan-developpement.md`

Il doit préciser :

- ordre des modifications ;
- fichiers concernés ;
- migrations ;
- tests ;
- documentation ;
- stratégie de retour arrière.

## Étape 6 — Développement

Le développement suit le plan validé.

Les changements non prévus doivent être signalés avant d’être intégrés.

## Étape 7 — QA

Responsable : `alex-qa`.

Sortie :

`04-rapport-qa.md`

Le rapport doit contenir les preuves :

- compilation ;
- lint ;
- tests unitaires ;
- tests d’intégration ;
- tests end-to-end ;
- vérification navigateur ;
- permissions ;
- migrations ;
- régressions.

## Étape 8 — Documentation

Responsable : `alex-documentation`.

Sortie :

`05-rapport-documentation.md`

La documentation concernée doit être réellement mise à jour après validation QA.

## Étape 9 — Clôture

Sortie :

`06-rapport-final.md`

Une fonctionnalité ne peut être déclarée TERMINÉE que si toutes les étapes obligatoires sont validées.