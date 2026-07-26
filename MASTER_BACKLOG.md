# MASTER BACKLOG — LCA-MES

> Document de référence unique du backlog LCA-MES.
>
> Toute nouvelle idée, fonctionnalité, évolution ou dette technique doit être ajoutée ici avant d'être développée.
>
> Les développements suivent obligatoirement le workflow :
>
> Backlog → Analyse PO → Analyse Architecte → Validation humaine → Développement → QA → Documentation → Terminé
>
> Construit à partir de `CLAUDE.md`, `README.md`, `MASTER_SPECIFICATION.md`, `PROJECT_STATE.md` et de l'ensemble de `docs/` (architecture, modèle de données, règles métier, roadmap, ADR 0001-0006). Toute feature listée ci-dessous est justifiée par au moins un de ces documents.

---

# Vision

Créer le logiciel MES de référence pour le pilotage de la production de concentrés de cigarettes électroniques chez LCA Distribution.

Le logiciel doit être :

- simple à utiliser ;
- extrêmement fiable ;
- totalement traçable ;
- évolutif ;
- orienté métier ;
- capable d'intégrer progressivement CRM, Achats, R&D, Qualité et IA.

---

# Roadmap

Les documents officiels (`MASTER_SPECIFICATION.md`, `docs/roadmap.md`) ne définissent qu'une **unique version V0.9** (échéance fin août 2026), qui couvre déjà Traçabilité/Qualité/Coûts (Jalon 3) et Exports/Sauvegardes (Jalon 4). Correspondance retenue avec le séquençage `v0.9 → v2.0` :

| Jalon documenté | Statut réel | Version retenue |
|---|---|---|
| Jalon 0 — Cadrage | Terminé | — |
| Jalon 1 — Socle technique | Terminé (2026-07-05) | v0.9 |
| Jalon 2 — Catalogue & cœur production | Terminé (2026-07-07) | v0.9 |
| Jalon 2.5 — Gestion des utilisateurs | Terminé (2026-07-07) | v0.9 |
| Audit + corrections V0.3 (7 itérations, 2026-07-08 → 2026-07-16) | Terminé | v0.9 |
| Jalon 3 — Traçabilité, qualité, coûts | Démarré partiellement (traçabilité, backend + frontend partiels, 2026-07-18/19 — voir PRD-08/PRD-09/TRAC-01→04) ; qualité et coûts non démarrés | v1.0 / v1.2 (Production complète / Qualité) |
| Jalon 4 — Exports, tableaux de bord, sauvegardes | Non démarré | v1.1 (Administration) |
| Post-V0.9 (`logistique`, `r&d`, `planning`) | Non conçu | v1.3 (R&D) / hors périmètre |
| CRM, Achats (au sens ERP), IA avancée | Jamais mentionnés comme fonctionnalités concrètes | v2.0 (Entreprise) — aspirationnel, aucun contenu documenté |

## v0.9 — Fondation

Disposer d'un MES totalement utilisable au laboratoire.

## v1.0 — Production

Couvrir entièrement la production.

## v1.1 — Administration

Compléter les fonctions administratives.

## v1.2 — Qualité

Gestion qualité complète.

## v1.3 — R&D

Développement de nouvelles recettes.

## v2.0 — Entreprise

Faire de LCA-MES le cœur du système d'information de LCA Distribution.

---

# Epics

Chaque Feature n'appartient qu'à un seul Epic (voir "Décisions d'organisation" en fin de section pour les cas où plusieurs rattachements étaient plausibles).

## EPIC 01 — Production

| ID | Feature | Priorité | Statut | Version |
|----|---------|----------|--------|---------|
| PRD-01 | Création de batch (recette + machine + format + quantité), validée contre recette active et format machine | Haute | Terminé | V0.9 |
| PRD-02 | Calcul automatique des quantités de préparation (volume + masse) à partir de la recette | Haute | Terminé | V0.9 |
| PRD-03 | Workflow 4 étapes (préparation/mélange/incorporation trémie/conditionnement), `BatchStep` distinct de `BatchStatus` | Haute | Terminé | V0.9 |
| PRD-04 | Gestion des arrêts de batch (motif, durée calculée) | Moyenne | Terminé | V0.9 |
| PRD-05 | Clôture de batch : génération du lot + déduction stock atomique (transaction unique) | Haute | Terminé | V0.9 |
| PRD-06 | Analyse de faisabilité avant lancement (`BatchFeasibilityService`, ADR 0005) : blocage si stock insuffisant, quantité max produisible, ajustement explicite | Haute | Terminé | V0.9 |
| PRD-07 | Génération du numéro de lot (`LotNumberGeneratorService`) | Haute | Terminé (implémentation placeholder — voir DEBT-01) | V0.9 |
| PRD-08 | Généalogie du lot (`LotGenealogy`) — écran de consultation dédié (module `traceability`) | Moyenne | Partiellement terminé (2026-07-18/19) — backend en lecture livré (`GET /traceability/lots/:id`, `GET /traceability/stock-lots/:id`) et écran de recherche par UUID livré ; **les lignes de généalogie ne sont pas encore affichées à l'écran** — voir TRAC-01/TRAC-02/TRAC-04 | V0.9 (Jalon 3) |
| PRD-09 | Consultation du numéro de lot après rechargement d'un batch terminé | Faible | Partiellement débloqué (2026-07-18/19) — `GET /traceability/lots/:id` permet techniquement de recharger un lot, mais sans moyen réaliste d'en retrouver l'UUID (pas de recherche par numéro, pas de lien depuis Production) — voir TRAC-03A/TRAC-03B | V0.9 (Jalon 3) |
| PRD-10 | Calcul et historisation du coût par flacon (`BatchCost`) | Moyenne | Non démarré | V0.9 (Jalon 3) |
| PRD-11 | Allocation multi-marchés (un batch réparti entre plusieurs marchés, un lot par allocation — voir ADR-0006 et `docs/features/PRD-11-allocation-multi-marches/`) | P0 | **Terminé (2026-07-22)** — backend (schéma Prisma, `catalog/markets`, `catalog/product-families`, `BatchProductAllocationsService`, `BatchFeasibilityService`/`BatchClosureService` étendus) et frontend (5 tickets, `ProductionPage.tsx`) livrés ; recette fonctionnelle globale réalisée, conclusion « validé avec réserves mineures » (voir `PROJECT_STATE.md` §6) | V0.9 (Jalon 2) |
| TRAC-01 | Afficher les lignes de généalogie (matières premières/packaging consommés, avec lot fournisseur) sur l'écran de traçabilité d'un lot | Moyenne | Proposé (2026-07-20) | V0.9 (Jalon 3) |
| TRAC-02 | Intégrer la traçabilité inverse (`GET /traceability/stock-lots/:id`) côté frontend | Moyenne | Proposé (2026-07-20) | V0.9 (Jalon 3) |
| TRAC-03A | Recherche d'un lot par numéro (`455XXX`) sur l'écran de traçabilité | Faible | Proposé (2026-07-20) | V0.9 (Jalon 3) |
| TRAC-03B | Lien direct vers la fiche de traçabilité d'un lot depuis l'écran Production, après clôture d'un batch | Faible | Proposé (2026-07-20) | V0.9 (Jalon 3) |
| TRAC-04 | Tests e2e des deux endpoints `traceability` (cas trouvé, non trouvé, hors site, ouverture `DIRECTION`/`DAF`) | Faible | Proposé (2026-07-20) | V0.9 (Jalon 3) |

## EPIC 02 — Stocks

| ID | Feature | Priorité | Statut | Version |
|----|---------|----------|--------|---------|
| STK-01 | État des stocks par article + mouvements horodatés (`StockMovement`) | Haute | Terminé | V0.9 |
| STK-02 | Affectation FIFO des `StockLot` à la consommation | Haute | Terminé | V0.9 |
| STK-03 | Ajustement d'inventaire ciblé sur un `StockLot` précis | Haute | Terminé | V0.9 |
| STK-04 | Seuil de stock minimum + indicateur stock faible (calculé serveur) | Moyenne | Terminé | V0.9 |
| STK-05 | Équivalent carton (affichage uniquement) | Faible | Terminé | V0.9 |

## EPIC 03 — Matières Premières

| ID | Feature | Priorité | Statut | Version |
|----|---------|----------|--------|---------|
| MP-01 | Gestion des articles (table unique MP/Packaging/Produit fini) | Haute | Terminé | V0.9 |
| MP-02 | Modification d'articles existants (`unitsPerCarton`, `densityKgPerL` inclus) | Haute | Terminé | V0.9 |
| MP-03 | Changement de type d'article encadré (bloqué si déjà utilisé) | Moyenne | Terminé | V0.9 |
| MP-04 | Densité (`densityKgPerL`) pour le calcul de masse à peser | Moyenne | Terminé | V0.9 |
| MP-05 | Recettes versionnées (composition %, archivage automatique, immutabilité) | Haute | Terminé | V0.9 |
| MP-06 | Brouillons de recettes avec autosave (ADR 0004) | Moyenne | Terminé | V0.9 |
| MP-07 | Sélecteur d'ingrédient recherchable dans les recettes (`ArticleSearchSelect`) | Faible | Terminé | V0.9 |
| MP-08 | Recherche instantanée du Catalogue (désignation/référence/fournisseur/type) | Faible | Terminé | V0.9 |

## EPIC 04 — Conditionnement

| ID | Feature | Priorité | Statut | Version |
|----|---------|----------|--------|---------|
| CDT-01 | Gestion des machines de conditionnement (CRUD, formats supportés) | Haute | Terminé | V0.9 |
| CDT-02 | Règle de conditionnement en cartons (10/30/50/100 ml → 100 ; 200 ml → 36) | Faible | Terminé (affichage uniquement) | V0.9 |

## EPIC 05 — Administration

| ID | Feature | Priorité | Statut | Version |
|----|---------|----------|--------|---------|
| ADM-01 | Authentification JWT + 4 rôles (`RESPONSABLE_LABORATOIRE`/`RESPONSABLE_ADJOINT`/`DIRECTION`/`DAF`) | Haute | Terminé | V0.9 |
| ADM-02 | Gestion des utilisateurs (création, modification, désactivation, réinitialisation mot de passe) | Haute | Terminé | V0.9 |
| ADM-03 | Fonction métier (`JobTitle`) distincte du rôle logiciel | Faible | Terminé | V0.9 |
| ADM-04 | Administrateur système (`isSystemAdmin`) indépendant du rôle | Moyenne | Terminé | V0.9 |
| ADM-05 | Changement de mot de passe obligatoire à la première connexion | Moyenne | Terminé | V0.9 |
| ADM-06 | Historique de connexion (`LoginHistory`) | Faible | Terminé | V0.9 |
| ADM-07 | Protection anti-auto-retrait admin (désactivation/statut) | Moyenne | Terminé | V0.9 |
| ADM-08 | Journal d'audit technique (`AuditLog`, gestion des comptes) | Moyenne | Terminé (périmètre limité aux comptes) | V0.9 |
| ADM-09 | Tableau de bord (accueil personnalisé + 7 indicateurs de synthèse) | Faible | Terminé | V0.9 |
| ADM-10 | Tableaux de bord et rapports dédiés `DIRECTION`/`DAF` | Moyenne | Non démarré | V0.9 (Jalon 4) |
| ADM-11 | Sauvegardes automatiques (`pg_dump` planifié + rotation + restauration testée) | Haute | Non démarré | V0.9 (Jalon 4) |
| ADM-12 | Refonte de la navigation (sidebar), pour absorber les futurs modules | Faible | Non conçu | V0.4 (nom informel donné par `docs/roadmap.md`) |

## EPIC 06 — Qualité

| ID | Feature | Priorité | Statut | Version |
|----|---------|----------|--------|---------|
| QUA-01 | Contrôle qualité multi-type par lot (`QualityCheck` : visuel/organoleptique/physico-chimique/packaging/documentaire) | Moyenne | Non démarré | V0.9 (Jalon 3) |
| QUA-02 | Pièces jointes de contrôle qualité (`QualityCheckAttachment`) | Faible | Non démarré | V0.9 (Jalon 3) |
| QUA-03 | Calcul automatique du statut qualité global du lot | Moyenne | Non démarré (règle exacte à valider — voir DEBT-03) | V0.9 (Jalon 3) |

## EPIC 07 — Communication

| ID | Feature | Priorité | Statut | Version |
|----|---------|----------|--------|---------|
| COM-01 | Système de retours utilisateurs intégré (`Feedback` : type/priorité/statut, écran admin) | Moyenne | Terminé | V0.9 |
| COM-02 | Notification Make (webhook → agent IA → e-mail) sur chaque retour créé | Moyenne | En cours, non commité | V0.9 |

## EPIC 08 — R&D

| ID | Feature | Priorité | Statut | Version |
|----|---------|----------|--------|---------|
| RD-01 | Recettes expérimentales, essais, validation/rejet, promotion vers le catalogue production | Faible | Non conçu | Post-V0.9 |

## EPIC 09 — CRM

| ID | Feature | Priorité | Statut | Version |
|----|---------|----------|--------|---------|

*Aucune fonctionnalité CRM n'est mentionnée dans un quelconque document — epic vide, conservé pour la roadmap v2.0.*

## EPIC 10 — Achats

| ID | Feature | Priorité | Statut | Version |
|----|---------|----------|--------|---------|
| ACH-01 | Gestion des fournisseurs (`Supplier` CRUD, fournisseur principal MP + Packaging) | Moyenne | Terminé | V0.9 |

## EPIC 11 — IA

| ID | Feature | Priorité | Statut | Version |
|----|---------|----------|--------|---------|
| AI-01 | Analyse d'architecture de l'assistant IA (orchestrateur, cartographie des domaines existants, abstraction fournisseur, protocole de confirmation humaine pour de futures actions) | Haute | Terminé (2026-07-23) | V0.9 (extension assumée, voir `docs/roadmap.md`) |
| AI-02 | Socle technique de l'assistant (module `assistant`, abstraction `AiProvider`, endpoint SSE, persistance `AiConversation`/`AiMessage`, panneau frontend minimal) | Haute | Terminé (2026-07-23) | V0.9 |
| AI-03 | 6 outils métier réels, strictement en lecture seule (dashboard, stock, traçabilité, production, imports) | Haute | Terminé (2026-07-23) | V0.9 |
| AI-04 | Orchestration du tool calling (`ToolCallingOrchestrator` : tours de raisonnement, exécution des outils, garde-fous anti-boucle) | Haute | Terminé (2026-07-24) | V0.9 |
| AI-05 | Moteur de contexte (`ContextEngine` : prompt système, contexte statique, résumé/troncature de l'historique, budget de tokens) | Haute | Terminé (2026-07-24) | V0.9 |
| AI-06 | Fournisseur OpenAI réel (`OpenAiProvider`, SDK officiel `openai`), optionnel via `AI_PROVIDER=openai` ; `EchoAiProvider` reste le fournisseur par défaut et le repli local | Haute | Terminé (2026-07-24) | V0.9 |

**Tickets AI-01 à AI-06 tous validés explicitement par l'utilisateur, ticket par ticket, avant implémentation et commit** (voir `docs/roadmap.md`, section « Chantier IA — Assistant »). Périmètre strictement limité à l'infrastructure, à 6 outils en lecture seule et à un fournisseur optionnel : **aucune action métier en écriture, aucune optimisation de planning** n'est couverte — toute extension reste hors périmètre tant qu'elle n'a pas fait l'objet d'une validation équivalente, ticket par ticket.

## EPIC 12 — Imports/Exports OpenSi

| ID | Feature | Priorité | Statut | Version |
|----|---------|----------|--------|---------|
| IMP-01 | Moteur générique de mapping de colonnes (ADR 0003), réutilisable par de futurs connecteurs | Haute | Terminé | V0.9 |
| IMP-02 | Import Articles (upsert par référence OpenSi, type immuable) | Haute | Terminé | V0.9 |
| IMP-03 | Import Stocks (atomique, réutilise la réception de stock) | Haute | Terminé | V0.9 |
| IMP-04 | Import Besoins attendus (historique append-only) | Moyenne | Terminé | V0.9 |
| IMP-05 | Import Inventaire | Moyenne | Partiellement terminé (prévisualisation seule, `confirm()` renvoie `501`) | V0.9 |
| IMP-06 | Écran frontend Imports (assistant 5 étapes + historique) | Haute | Terminé | V0.9 |
| IMP-07 | Exports vers OpenSi (productions, consommations, mouvements, inventaires, rapports) | Moyenne | Non démarré | V0.9 (Jalon 4) |
| IMP-08 | Écran de planification à partir des besoins attendus (`besoinCalculé`/`quantitéSuggérée`) | Moyenne | Non démarré (formule à valider — voir DEBT-02) | V0.9 (Jalon 2/3) |

## Décisions d'organisation

Cas où plusieurs rattachements étaient plausibles — arbitrage retenu et justification, plutôt qu'une duplication de la Feature :

- **ACH-01 (Fournisseurs)** → Epic 10 (Achats), plutôt qu'Epic 03 (Matières Premières) ou Epic 04 (Conditionnement). Un fournisseur principal s'applique aux deux types d'articles (`docs/regles-metier.md` §14) : son rattachement naturel est le domaine transversal "achat", pas l'un ou l'autre des deux types.
- **PRD-10 (Coût par flacon)** → Epic 01 (Production), en l'absence d'epic Finance/Reporting dédié. Le coût est calculé et figé à la clôture du batch (`docs/modele-donnees.md` §7) : c'est une sortie du processus de production, pas un module autonome.
- **PRD-08 (Généalogie du lot)** → Epic 01 (Production), plutôt qu'un epic "Traçabilité" dédié (le découpage modulaire réel a un module `traceability` séparé — `docs/architecture.md` §3 — mais cet epic n'existe pas dans ce backlog). La généalogie est générée à la clôture d'un batch, donc rattachée au cycle de vie de la production.
- **MP-05 à MP-08 (Recettes, brouillons, sélecteur d'ingrédient, recherche Catalogue)** → Epic 03 (Matières Premières), plutôt qu'Epic 04 (Conditionnement), bien qu'une recette contienne aussi des lignes de packaging. La recette est structurée autour de la règle des 100 % de matière première (`docs/regles-metier.md` §12), qui en est la contrainte centrale.
- **CDT-02 (Règle de conditionnement en cartons)** → Epic 04 (Conditionnement), distinct de MP-02 (modification d'articles). MP-02 couvre la possibilité de modifier le champ `unitsPerCarton` sur un article ; CDT-02 couvre la règle métier de correspondance format → carton elle-même (`docs/modele-donnees.md` §1). Deux aspects différents du même champ, pas la même Feature.
- **ADM-09 (Tableau de bord)** → Epic 05 (Administration), bien qu'il agrège des données de tous les modules (articles, recettes, machines, stock, production, retours, besoins — `PROJECT_STATE.md` §2). Choisi comme écran de pilotage/supervision transversal, pas comme fonctionnalité d'un domaine métier particulier.
- **COM-02 (Webhook Make)** : travail réellement effectué (code présent, testé, fonctionnel) mais non commité et absent de `PROJECT_STATE.md` au moment de la rédaction de ce backlog — statut "En cours, non commité" retenu explicitement plutôt que "Terminé", pour ne pas anticiper une écriture de documentation qui n'a pas encore eu lieu.
- **TRAC-01 à TRAC-04 (préfixe `TRAC-` distinct de `PRD-`)** : ces tickets, proposés le 2026-07-20 pour compléter PRD-08/PRD-09, restent rattachés à l'Epic 01 (Production) comme PRD-08/PRD-09 eux-mêmes — même logique que la décision ci-dessous sur PRD-08 (pas d'epic "Traçabilité" séparé dans ce backlog). Le préfixe `TRAC-` est conservé (plutôt que de les numéroter PRD-12+) pour qu'ils restent identifiables comme les tickets d'exécution issus de l'analyse PO du 2026-07-20, sans renuméroter PRD-08/PRD-09 qu'ils complètent.

---

# Sécurité

Audit de sécurité mené en dehors du backlog fonctionnel courant, huit tickets tous terminés et déployés sur `main` les 2026-07-19 et 2026-07-20 (build, tests unitaires et e2e vérifiés après chacun, aucune régression fonctionnelle) :

| ID | Sujet | Statut |
|----|-------|--------|
| SEC-01 | Protection du script `seed.ts` contre une exécution accidentelle en production | Terminé |
| SEC-02 | Limitation de débit (rate limiting) sur `POST /auth/login` | Terminé |
| SEC-03 | Documentation Swagger (`/api/docs`) désactivée en production | Terminé |
| SEC-04 | En-têtes de sécurité HTTP (Helmet) + Content-Security-Policy | Terminé |
| SEC-06 | Validation renforcée de `JWT_SECRET` (longueur minimale, rejet des valeurs faibles/d'exemple) | Terminé |
| SEC-07 | Validation du contenu réel des fichiers importés (signature binaire, indépendante de l'extension/Content-Type) | Terminé |
| SEC-08 | Verrouillage de la version de la dépendance `xlsx` (0.20.3, CDN officiel SheetJS) | Terminé |

---

# Dette technique

| ID | Sujet | Priorité | Statut |
|----|-------|----------|--------|
| DEBT-01 | Algorithme réel de génération du numéro de lot (convention `455XXX` confirmée, détail non fourni) — actuellement un compteur séquentiel placeholder | Haute | En attente d'information utilisateur |
| DEBT-02 | Formule exacte de `besoinCalculé`/`quantitéSuggérée` (besoins attendus) | Haute | À valider (bloque IMP-08) |
| DEBT-03 | Règle exacte de calcul du statut qualité global du lot à partir des `QualityCheck` | Moyenne | À valider (bloque QUA-03) |
| DEBT-04 | Stratégie de réconciliation de l'import Inventaire (granularité lot fournisseur vs quantité globale) | Moyenne | En attente d'un fichier réel OpenSi |
| DEBT-05 | Notion de "gamme" (regroupement de produits) absente du modèle de données | Moyenne | À préciser (bloque planification par gamme) |
| DEBT-06 | Docker/`docker-compose.yml` jamais exécutés de bout en bout avec un Docker réel | Faible | À valider avant premier déploiement réel |
| DEBT-07 | Vulnérabilités npm résiduelles pré-existantes (chaîne `@hono/node-server`/`@prisma/dev`/`prisma`, 3 alertes modérées) | Faible | Surveillé |
| DEBT-08 | Mot de passe temporaire de Jean-Paul Gouveia non conservé (`mustChangePassword` toujours vrai) | Faible | Réinitialisation manuelle à faire avant sa première utilisation réelle |
| DEBT-09 | Analyse/détection d'anomalies sur `LoginHistory` (tentatives répétées, IP inhabituelle) | Faible | Non démarré, reportée |
| DEBT-10 | Bandeau global d'avertissement pour un brouillon référençant un ou plusieurs articles désactivés (le texte de repli par ligne est fait, pas le bandeau récapitulatif) | Faible | Amélioration future non implémentée |
| DEBT-11 | Intégration du logo SVG officiel Maison Fuel | Faible | Reporté volontairement |
| DEBT-12 | Dérive de `PROJECT_STATE.md`/`MASTER_BACKLOG.md` par rapport à l'état réel du dépôt (module `traceability`, audit SEC-01→08, statut réel de PRD-11 non reflétés) | Moyenne | Terminé (ticket TRAC-05, 2026-07-20) |
| DEBT-13 | ADR dédié à l'architecture de l'assistant IA (AI-01 → AI-06) : annoncé (« voir `docs/adr` à venir ») mais jamais rédigé — formaliser l'orchestrateur, l'abstraction `AiProvider`, le registre d'outils et les garde-fous dans un ADR séparé | Faible | Proposé (2026-07-26, ticket DOC-01) — contenu non rédigé, rédaction non commencée |

---

# Parking

Idées futures qui ne sont pas encore planifiées : actées comme "à garder à l'esprit" mais non conçues, non planifiées en détail, ou explicitement hors périmètre V0.9.

- **Module `planning` / ordonnancement** — priorité future déjà identifiée par l'utilisateur ("futur module prioritaire", Jalon 3+) mais non conçu ; dépend de DEBT-02 et DEBT-05.
- **Module `logistique`** (post-V0.9) — expédition, conditionnement cartons, exports transporteurs.
- **Système de réservation de stock au lancement d'un batch** — explicitement écarté pour la V0.9 dans l'ADR 0005, évolution future distincte.
- **Évolution FEFO** (péremption) pour l'affectation des stocks, en alternative au FIFO actuel.
- **Bascule de la recherche du Catalogue vers le backend avec pagination** — à envisager seulement si le catalogue atteint plusieurs milliers d'articles.
- **Mise en évidence (highlight) du texte correspondant à une recherche** — idée UX, non conçue.
- Multi-site complet, connexion machine directe (OPC-UA/Modbus/MQTT), gateway edge/IoT, application mobile, IA avancée/optimisation de planning — explicitement hors périmètre V0.9 (`MASTER_SPECIFICATION.md` §5, `README.md`, `CLAUDE.md`).
- Epics 09 (CRM) et 11 (IA) — aucun contenu documenté à ce jour, réservés pour la roadmap v2.0.
