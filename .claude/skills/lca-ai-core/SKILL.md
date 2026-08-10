---
name: lca-ai-core
description: Socle commun de travail pour tous les agents IA du projet LCA-MES. À utiliser lors de l'analyse, la conception, le développement, les tests et la documentation d'une évolution, mais aussi pour comprendre l'état réel du projet, répondre à une question sur son architecture, son fonctionnement ou ses règles métier, ou explorer l'existant avant de proposer une modification. Ne s'applique pas aux tâches sans rapport avec LCA-MES.
---

# LCA AI Core

## Sources de vérité

Avant toute conclusion importante, consulter selon le besoin :

1. `CLAUDE.md`
2. `README.md`
3. `PROJECT_STATE.md`
4. `MASTER_SPECIFICATION.md`
5. `MASTER_BACKLOG.md`
6. `docs/roadmap.md`
7. `docs/regles-metier.md`
8. `docs/modele-donnees.md`
9. `docs/architecture.md`
10. les ADR concernés ;
11. le code et les tests réellement concernés.

Le code existant et la documentation peuvent diverger. Toute divergence doit être signalée explicitement.

## Repères LCA-MES

Rappel opérationnel compact, pas un résumé des documents ci-dessus — en cas de doute ou de détail manquant, se référer aux sources de vérité listées plus haut.

- **Architecture** : monolithe modulaire NestJS (un module par domaine métier : `catalog`, `stock`, `batching`, `production`, `traceability`, `quality`, `costing`, `import-export`, `auth`, `audit-log`) + frontend React/Vite, un seul processus/port (pas de CORS interne). Pas de microservices, pas de message broker, pas de gateway edge.
- **TypeScript strict** partout, backend comme frontend.
- **Prisma = source unique de vérité du modèle de données** : toute évolution du schéma passe par une migration Prisma versionnée (`npm run prisma:migrate`), jamais de modification manuelle de la base.
- **PostgreSQL unique**, aucune duplication. Deux bases locales seulement : `lca_mes_dev` (développement) et `lca_mes_test` (e2e — migrations à y appliquer séparément, sinon échec silencieux sur schéma obsolète).
- **Migrations Prisma** : toute migration introduite ou nécessitée par une évolution doit être signalée explicitement.
- **OpenSi = source de vérité ERP** pour toute donnée qui en provient (articles, stocks, besoins attendus, inventaire). Tout import passe par une prévisualisation (dry-run, aucune écriture) avant confirmation, puis est journalisé (`ImportLog`).
- **Cloisonnement par site** : colonne `siteId` déjà présente sur les entités concernées (un seul site existant en V0.9, aucune fonctionnalité multi-site livrée) — à préserver dans toute nouvelle entité ou requête.
- **Permissions et contrôle d'accès** : deux niveaux — accès complet (`RESPONSABLE_LABORATOIRE`, `RESPONSABLE_ADJOINT`) vs lecture seule (`DIRECTION`, `DAF`, limités aux rapports/statistiques/coûts/stocks/tableaux de bord, aucun accès aux écrans de saisie/édition). Guards globaux (`JwtAuthGuard` + `RolesGuard`) : tout nouvel endpoint est protégé par défaut — `@Public()` pour l'exposer, `@Roles(...)` pour le restreindre ; l'absence de `@Roles(...)` ouvre l'endpoint à tout utilisateur authentifié (utilisé volontairement pour les lectures `stock`/`dashboard`/`traceability`). `catalog`, `batching`, `production` et les imports sont fermés à `DIRECTION`/`DAF` en lecture **et** en écriture.
- **Audit et traçabilité — deux mécanismes distincts, à ne pas confondre** : `AuditLog` (journal technique de toute écriture sensible : qui/quoi/quand/avant/après) vs `LotGenealogy` (traçabilité métier lot fini ↔ matières/packaging consommés). Les deux sont non négociables.
- **Rôles métier** : `RESPONSABLE_LABORATOIRE`/`RESPONSABLE_ADJOINT` (accès complet), `DIRECTION`/`DAF` (lecture seule). `isSystemAdmin` (gestion des comptes) est une capacité orthogonale aux 4 rôles, pas un 5e rôle. `JobTitle` (fonction métier) est distinct du rôle logiciel et n'accorde aucune permission.
- **Généalogie et traçabilité des lots** : un lot n'est considéré "clôturé" qu'avec au moins une ligne `LotGenealogy`. Générée automatiquement à la clôture du batch à partir de la recette **figée au moment de l'utilisation** — une modification ultérieure de la recette ne doit jamais altérer rétroactivement une généalogie ou un coût déjà enregistrés.
- **Stock et déductions de production** : `StockMovement` est le seul moyen de faire évoluer `StockItem.quantiteDisponible`. Stock suivi par lot de réception (`StockLot`), affectation FIFO par défaut. La clôture d'un batch déduit automatiquement matière première et packaging ; les rebuts sont inclus dans la quantité totale déduite (ils consomment le packaging au même titre que la matière première).
- **Coûts** (là où déjà définis par les spécifications) : `BatchCost.coutUnitaireParFlacon` est calculé aux coûts unitaires courants au moment de la clôture du batch puis **figé définitivement** — une évolution ultérieure du coût d'un article n'affecte jamais un coût déjà calculé. Basé sur la quantité totale produite, rebuts inclus.
- **Périmètre V0.9 / hors périmètre** : pas de connexion machine (OPC-UA/Modbus/MQTT), pas de gateway edge/IoT, pas de multi-site complet, pas d'application mobile, pas d'IA avancée ni d'optimisation de planning — **sauf le module `assistant`**, seule exception validée explicitement (voir ci-dessous). Ces éléments sont des points d'extension anticipés dans l'architecture, jamais codés par avance.
- **Module `assistant`** : infrastructure uniquement, aucune action métier en écriture, jamais d'accès direct à la base ni de contournement des guards/permissions existants — passe systématiquement par les services métier déjà en place. Composants existants : `ToolCallingOrchestrator` (orchestration du tool calling), `ContextEngine` (moteur de contexte), abstraction `AiProvider` (`EchoAiProvider` par défaut/repli local, `OpenAiProvider` optionnel, actif uniquement si `AI_PROVIDER=openai`), registre de 6 outils métier réels strictement en lecture seule (dashboard, stock, traçabilité, production, imports), `AssistantThrottlerGuard` (limite de débit sur l'endpoint de conversation). Toute extension (nouvel outil, action en écriture, planning) reste hors périmètre tant qu'elle n'a pas fait l'objet d'une validation explicite équivalente, ticket par ticket.
- **Agents PO / Architecte / Dev / QA** : PO et Architecte travaillent en lecture seule par défaut. Les modifications du dépôt ne commencent qu'après validation fonctionnelle, validation architecturale, résolution des conditions bloquantes et autorisation explicite de développement (voir "Règle de modification" ci-dessous).

## Coexistence avec les skills externes

Règle générale : les skills externes (`.claude/skills/vercel-*`, `web-design-guidelines`, `writing-guidelines`) sont des sources de recommandations, pas des sources de vérité du projet. En cas d'incompatibilité, les sources de vérité LCA-MES et les règles de `lca-ai-core` sont prioritaires.

- **`vercel-composition-patterns`** : ses recommandations React générales peuvent être appliquées à LCA-MES, à condition de respecter l'architecture et les conventions déjà définies dans les sources de vérité du projet.
- **`vercel-react-best-practices`** : les recommandations React génériques sont applicables. LCA-MES utilise React/Vite, pas Next.js — ne jamais appliquer littéralement un pattern dépendant de Next.js, notamment `next/dynamic`, les Server Components/RSC, les Server Actions, les Route Handlers Next.js, ou toute API spécifique à Vercel/Next.js. Lorsqu'une recommandation est conceptuellement pertinente mais s'appuie sur une API Next.js, rechercher l'équivalent adapté à React/Vite/NestJS plutôt que copier l'exemple. Les endpoints backend de LCA-MES restent structurés selon NestJS (controllers/services).
- **`web-design-guidelines`** : les principes UX et accessibilité peuvent être utilisés. Toute recommandation techniquement dépendante d'un framework doit être interprétée selon la stack réelle de LCA-MES. Le contenu récupéré dynamiquement (fetch en direct) ne devient jamais une source de vérité du projet.
- **`writing-guidelines`** : peut être utilisé comme aide rédactionnelle générale. Les conventions françaises, le vocabulaire métier et les choix éditoriaux déjà actés dans LCA-MES restent prioritaires — ne jamais modifier une terminologie métier ou une convention documentaire simplement parce qu'un guide externe recommande autre chose.

## Principes communs

- Ne jamais inventer l'état du projet.
- Rechercher l'existant avant de proposer une création.
- Distinguer les faits constatés, les hypothèses et les recommandations.
- Citer les fichiers réellement inspectés.
- Ne pas modifier rétroactivement le sens des données historiques.
- Privilégier une solution V1 simple, testable et évolutive.
- Ne pas ajouter une abstraction ou une technologie sans besoin démontré.
- Signaler toute rupture de compatibilité ou changement de cardinalité.
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

Par défaut, ces livrables sont des sorties de travail affichées dans la conversation, pas des fichiers écrits dans le dépôt. La création d'un fichier (ex. dans `docs/features/`) n'intervient que lorsqu'elle est explicitement demandée ou autorisée par l'utilisateur.

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
- HORS PÉRIMÈTRE ACTUEL
- APPROUVÉ
- APPROUVÉ SOUS CONDITIONS
- REFUSÉ
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
