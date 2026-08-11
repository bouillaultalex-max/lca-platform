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
  *Exemple* : une règle recommandant `next/dynamic` pour charger un composant lourd à la demande ne doit jamais être copiée telle quelle — `next/dynamic` n'existe pas hors Next.js. Le besoin réel (chargement différé) reste pertinent en React/Vite ; l'équivalent est `React.lazy()` + `Suspense` **lorsque ce besoin architectural est réellement celui de la tâche**. Ne jamais remplacer mécaniquement une API Next.js par une API React sans d'abord vérifier que le besoin sous-jacent correspond effectivement.
- **`web-design-guidelines`** : les principes UX et accessibilité peuvent être utilisés. Toute recommandation techniquement dépendante d'un framework doit être interprétée selon la stack réelle de LCA-MES. Le contenu récupéré dynamiquement (fetch en direct) ne devient jamais une source de vérité du projet.
- **`writing-guidelines`** : peut être utilisé comme aide rédactionnelle générale. Les conventions françaises, le vocabulaire métier et les choix éditoriaux déjà actés dans LCA-MES restent prioritaires — ne jamais modifier une terminologie métier ou une convention documentaire simplement parce qu'un guide externe recommande autre chose.

### `pr-review-toolkit` (agents `code-reviewer`, `code-simplifier`, `comment-analyzer`, `pr-test-analyzer`, `silent-failure-hunter`, `type-design-analyzer`)

**Rôle du plugin** : `pr-review-toolkit` est complémentaire de `lca-ai-core`, pas concurrent. `lca-ai-core` définit les règles projet, métier, de validation et de workflow ; `pr-review-toolkit` intervient comme outil de qualité de code, principalement après ou pendant une implémentation déjà autorisée. Ses recommandations ne deviennent jamais des sources de vérité LCA-MES.

- **`code-simplifier`** : ne doit jamais modifier du code correspondant à une évolution encore en Cas A (« proposée mais non validée », voir "Règle de modification"). Il peut être utilisé sur une évolution déjà validée (Cas B), sous réserve des autres conditions bloquantes de `lca-ai-core` (Cas C). Avant toute modification autonome, il respecte la Règle de modification de `lca-ai-core` plutôt que d'agir "sans requête explicite" comme son propre prompt le suggère par défaut. Ses préférences stylistiques génériques (ex. `function` plutôt que fléchée, éviter `try/catch`) sont subordonnées aux conventions techniques et architecturales réelles de LCA-MES — ne jamais refactorer uniquement pour satisfaire une préférence générique si cela entre en conflit avec l'architecture ou les conventions déjà en place dans le projet.
- **`silent-failure-hunter`** : les références présentes dans ce skill à des infrastructures comme Sentry, Statsig, `logError`, `logForDebugging`, `logEvent` ou `errorIds.ts` ne doivent jamais être considérées comme présentes dans LCA-MES sans vérification du code réel — ce projet ne les utilise pas. Avant de signaler ou recommander une correction basée sur ces références, vérifier leur existence réelle dans le dépôt ; si elles n'existent pas, ne jamais présenter leur absence comme un défaut de LCA-MES. Appliquer ici systématiquement le principe "ne jamais inventer l'état du projet".
- **Règle générale** : les findings de `pr-review-toolkit` sont des recommandations d'analyse et de qualité, jamais un remplacement des règles métier, architecturales ou de validation de LCA-MES. En cas de conflit, les sources de vérité LCA-MES et les règles de `lca-ai-core` sont prioritaires. Une review de code (quel que soit l'agent) ne constitue jamais, à elle seule, une validation fonctionnelle ou architecturale au sens de la "Règle de modification".

### `security-guidance`

- **Rôle** : couche complémentaire d'analyse de sécurité (règles regex sur édition, revue LLM en fin de tour, revue agentique sur `git commit`/`git push`). Ses findings sont des alertes/recommandations, jamais une source de vérité LCA-MES. Une review de sécurité ne constitue pas à elle seule une validation fonctionnelle ou architecturale.
- **Finding et modification** : un finding de sécurité ne donne jamais automatiquement l'autorisation de modifier le code. Cas A (évolution proposée mais non validée) : analyser, signaler et proposer une correction, mais ne pas modifier. Cas B (évolution déjà validée) : une correction peut être envisagée dans le périmètre de l'évolution validée, sous réserve des autres règles de `lca-ai-core`. Cas C (contradiction, risque ou décision non tranchée) : `BLOQUÉ`. Les mécanismes automatiques du plugin, y compris ses hooks ou messages de réveil, ne contournent jamais cette règle.
- **Limites de couverture** : l'absence de finding de `security-guidance` ne constitue jamais une preuve d'absence de vulnérabilité — ses différentes couches de détection n'ont pas toutes la même couverture. Les contrôles LCA-MES concernant notamment permissions, guards, `siteId`, authentification/autorisation, `AuditLog` et `LotGenealogy` restent obligatoires lorsque pertinents.
- **Hooks et fin de tour** : vigilance particulière sur les mécanismes déclenchés à la fin d'un tour et lors des opérations `git commit`/`git push`. Un message de réveil ou une demande de correction générée par le plugin reste subordonné à la Règle de modification de `lca-ai-core` — il ne doit jamais être interprété comme une validation fonctionnelle ou architecturale.
- **Références externes** : ne jamais supposer qu'une infrastructure, bibliothèque, solution de logging ou de monitoring existe dans LCA-MES simplement parce qu'un outil de sécurité la mentionne. Vérifier systématiquement son existence réelle dans le dépôt avant d'en faire un finding applicable au projet — appliquer ici aussi le principe "ne jamais inventer l'état du projet".

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

Cette règle ne dépend pas de la formulation de la demande ("fais X" ne suffit pas à lui seul) mais de l'état réel de validation de l'évolution. Trois situations distinctes :

### A. Évolution proposée mais non validée

L'agent peut analyser l'existant, identifier les impacts, et produire une proposition, une spécification ou un plan. Il ne doit pas commencer à modifier le code ou le modèle de données simplement parce que l'utilisateur a demandé de faire une évolution, si celle-ci n'a pas encore reçu la validation fonctionnelle/architecturale requise par le workflow LCA-MES (PO → Architecte → Dev). Il s'arrête au niveau approprié (ex. verdict `PRÊT POUR VALIDATION HUMAINE`) et demande ou attend la validation prévue par le processus.

*Exemple* : "Ajoute la possibilité de facturer directement depuis un batch" — aucune spécification ni revue d'architecture n'existe sur ce sujet. L'agent produit une analyse de l'existant et une proposition (impacts, modèle de données envisagé, questions ouvertes), verdict `PRÊT POUR VALIDATION HUMAINE`, sans écrire de code ni de migration.

### B. Évolution déjà validée

Si la validation fonctionnelle et architecturale requise a déjà été explicitement donnée dans la conversation, ou est établie par les sources de vérité du projet (ex. un ticket marqué `APPROUVÉ`/`VALIDÉ` dans `PROJECT_STATE.md` ou `MASTER_BACKLOG.md`, une décision confirmée dans `docs/regles-metier.md`), l'agent ne redemande pas inutilement cette validation déjà acquise. Il poursuit vers l'étape suivante du workflow (conception détaillée, code, migration, tests), sous réserve des autres conditions bloquantes (voir C).

*Exemple* : "La spécification PO et la revue d'architecture pour PRD-11 sont approuvées, développe-la" — l'agent vérifie que ces validations existent bien (fichiers/décisions citées), puis développe directement, sans redemander une validation déjà obtenue.

### C. Blocage détecté

Même lorsqu'une évolution est validée, l'agent s'arrête si une condition bloquante apparaît en cours de route : contradiction entre documentation et code, problème d'architecture, migration dangereuse, permission non définie, règle métier inconnue ou non tranchée, etc. Il signale précisément le blocage (verdict `BLOQUÉ`), plutôt que de trancher seul ou de continuer en supposant une réponse.

Cette règle ne doit jamais être lue comme une interdiction absolue de produire du code : le comportement attendu dépend de l'état réel de validation constaté et du rôle de l'agent dans la conversation, pas d'une prudence systématique.

## Qualité minimale

Une évolution n'est terminée que si :

- le code compile ;
- les tests concernés passent ;
- les régressions principales ont été vérifiées ;
- les permissions ont été contrôlées ;
- la documentation nécessaire a été mise à jour ;
- les migrations ont été testées ;
- le rapport final mentionne les preuves de validation.
