---
name: lca-ai-core
description: Socle commun de travail pour tous les agents IA du projet LCA-MES. À utiliser lors de l'analyse, la conception, le développement, les tests et la documentation d'une évolution.
---

# LCA AI Core

## Sources de vérité

Avant toute conclusion importante, consulter selon le besoin :

1. `CLAUDE.md`
2. `PROJECT_STATE.md`
3. `MASTER_SPECIFICATION.md`
4. `docs/roadmap.md`
5. `docs/regles-metier.md`
6. `docs/modele-donnees.md`
7. `docs/architecture.md`
8. les ADR concernés ;
9. le code et les tests réellement concernés.

Le code existant et la documentation peuvent diverger. Toute divergence doit être signalée explicitement.

## Principes communs

- Ne jamais inventer l'état du projet.
- Rechercher l'existant avant de proposer une création.
- Distinguer les faits constatés, les hypothèses et les recommandations.
- Citer les fichiers réellement inspectés.
- Préserver le cloisonnement par site.
- Préserver les permissions, l'audit et la traçabilité.
- Ne pas modifier rétroactivement le sens des données historiques.
- Privilégier une solution V1 simple, testable et évolutive.
- Ne pas ajouter une abstraction ou une technologie sans besoin démontré.
- Signaler toute migration Prisma.
- Signaler toute rupture de compatibilité ou changement de cardinalité.
- OpenSi reste la source de vérité ERP.
- Ne jamais déclarer une tâche terminée sans preuve de validation.

## Classification des livrables

Chaque évolution reçoit un identifiant stable au format :

`YYYY-MM-DD-nom-court`

Exemple :

`2026-07-16-batch-multi-marches`

Les livrables associés utilisent le même identifiant :

- spécification PO ;
- revue d'architecture ;
- plan de développement ;
- rapport QA ;
- rapport de documentation ;
- rapport final.

## Passage entre agents

Chaque agent doit transmettre :

- le besoin traité ;
- les éléments constatés ;
- les décisions prises ;
- les décisions encore ouvertes ;
- les fichiers concernés ;
- son verdict ;
- les instructions destinées à l'étape suivante.

Un agent ne doit pas supposer qu'un autre agent connaît le contenu de sa session.

## États autorisés

- BROUILLON
- BLOQUÉ
- PRÊT POUR VALIDATION HUMAINE
- APPROUVÉ
- APPROUVÉ SOUS CONDITIONS
- EN DÉVELOPPEMENT
- À CORRIGER
- VALIDÉ
- TERMINÉ

## Règle de modification

Par défaut, les agents PO et Architecte travaillent en lecture seule.

Les modifications du dépôt ne commencent qu'après :

1. validation fonctionnelle ;
2. validation architecturale ;
3. résolution des conditions bloquantes ;
4. autorisation explicite de développement.

## Qualité minimale

Une évolution n'est terminée que si :

- le code compile ;
- les tests concernés passent ;
- les régressions principales ont été vérifiées ;
- les permissions ont été contrôlées ;
- la documentation nécessaire a été mise à jour ;
- les migrations ont été testées ;
- le rapport final mentionne les preuves de validation.
