# ADR 0009 — Sauvegardes automatiques PostgreSQL (ADM-11)

## Statut

Accepté — 2026-08-18. Revue d'architecture (`alex-architecte`) conclue **« Bloqué — informations manquantes »** le 2026-08-18 (cible de stockage externe non définie, choix du langage de script non tranché), puis **« Approuvé »** après obtention des décisions manquantes auprès de l'utilisateur le même jour — aucun code, script ni migration écrit avant cette validation.

## Contexte

`ADM-11` (sauvegardes automatiques) figure au backlog avec priorité Haute (`MASTER_BACKLOG.md`) depuis le Jalon 4, mais aucune implémentation n'existe dans le dépôt : aucun mécanisme de `pg_dump`, aucun scheduler (`@nestjs/schedule` absent des dépendances), aucune intégration de stockage externe. Le logiciel est déjà utilisé par de vrais comptes (Kevin, Jean-Paul) sans aucune protection contre une perte de données — c'est le risque métier qui motive cette tranche.

Le projet est déployé **on-premise**, sur le serveur du laboratoire (voir `MASTER_SPECIFICATION.md`, ADR 0001) — pas d'environnement cloud, pas d'orchestrateur, pas de CI/CD (`Glob(".github/workflows/*")` ne renvoie rien). `docker-compose.yml` publie déjà PostgreSQL sur `127.0.0.1:5432` avec un commentaire explicite préexistant à cette tranche (*« permet un accès psql/sauvegarde depuis le poste hôte sans exposer PostgreSQL au reste du réseau »*) — l'intention d'outiller une sauvegarde depuis le poste hôte était donc déjà anticipée dans l'infrastructure. `docs/architecture.md` anticipe également, dans son arborescence cible, un fichier `scripts/backup.ps1` (*« sauvegarde automatique (pg_dump + rotation) »*) — le dossier `scripts/` n'existe pas encore, mais l'intention documentaire de recourir à PowerShell préexiste elle aussi.

**DEBT-06** (`MASTER_BACKLOG.md`, priorité Faible, *« À valider avant premier déploiement réel »*) reste non résolue : Docker/`docker-compose.yml` n'ont jamais été exécutés de bout en bout dans cet environnement de développement. Cette dette est **préexistante et non résolue par cet ADR** — la conception retenue ci-dessous reste volontairement compatible avec un déploiement PostgreSQL conteneurisé (via le port déjà publié sur `127.0.0.1`) ou nativement installé sur le serveur, sans trancher DEBT-06 elle-même.

Une revue d'architecture (`alex-architecte`, 2026-08-18) a d'abord bloqué faute de cible de stockage réelle et de choix de langage de script, refusant explicitement d'inventer l'un ou l'autre. Les deux ont depuis été tranchés par l'utilisateur — objet de cet ADR.

## Problème

Cinq questions restaient ouvertes à l'issue de la revue d'architecture, dont deux réellement bloquantes :

1. **Cible de stockage externe** : aucune infrastructure de ce type (NAS, cloud, S3, FTP) n'existe dans le dépôt — bloquant, non inventable.
2. **Langage du script d'orchestration** : PowerShell (déjà documenté) vs TypeScript/`tsx` (seul précédent réel du dépôt) — impact réel sur la testabilité, à trancher explicitement.
3. Fréquence du test de restauration périodique — aucune convention existante.
4. Décision d'alerting en cas d'échec répété — aucun canal générique existant.
5. Gestion du cas d'une double exécution le même jour, sans ambiguïté sur le sens de « 30 sauvegardes quotidiennes ».

## Décisions

1. **Déclenchement** : Planificateur de tâches Windows (Task Scheduler), une exécution quotidienne, hors des heures de production autant que possible (créneau nocturne indicatif — l'heure exacte relève de la configuration de la tâche planifiée, pas d'une décision d'architecture figée ici). Aucun scheduler applicatif (`@nestjs/schedule` ou équivalent) introduit : le déclenchement reste indépendant du cycle de vie du processus API.
2. **Langage du script** : **PowerShell**. Justification : environnement Windows natif, cohérent avec le Planificateur de tâches Windows et avec `docs/architecture.md` qui anticipe déjà `scripts/backup.ps1`. TypeScript/`tsx` n'est pas introduit pour ce besoin, malgré son statut de seul précédent réel de script autonome dans le dépôt (`bootstrap-admin.ts`) — décision explicite de l'utilisateur, non remise en cause par cet ADR.
3. **Format de sauvegarde** : `pg_dump -Fc` (format custom, déjà compressé) vers un répertoire de **staging local** avant tout déplacement vers la destination finale.
4. **Stockage** : **disque local du serveur LCA lui-même** (le serveur qui héberge PostgreSQL), dans un répertoire dédié distinct du répertoire d'installation applicatif — jamais le poste développeur, jamais un NAS, un service cloud, S3 ou FTP. Aucune autre cible n'est introduite par cet ADR.
5. **Rétention** : 30 sauvegardes quotidiennes.
   - Nommage par **date calendaire** (`lca_mes_YYYYMMDD.dump`, granularité jour et non horodatage précis) : une deuxième exécution le même jour calendaire produit une nouvelle sauvegarde vers un nom temporaire, la valide (voir décision 6), puis ne **remplace** le fichier du jour que si cette validation réussit — jamais avant. Une deuxième exécution le même jour reste ainsi comptée comme une seule entrée de rétention, jamais deux, ce qui rend le sens de « 30 sauvegardes quotidiennes » univoque (30 jours calendaires distincts, pas 30 exécutions).
   - La purge des sauvegardes excédant 30 jours ne s'exécute **qu'après validation complète et réussie du cycle courant** (production + vérification `pg_restore --list` + écriture finale sur le disque du serveur). Tout échec à une étape interrompt le cycle **avant** la purge.
   - La sauvegarde du jour courant et, en toute circonstance, la dernière sauvegarde déjà validée avec succès, sont exclues de toute suppression — la purge ne cible que les fichiers strictement plus anciens que les 30 plus récents valides.
6. **Vérification de succès** :
   - **Quotidienne, légère** : `pg_restore --list` sur le fichier produit — un code retour 0 de `pg_dump` seul n'est **jamais** considéré comme une preuve suffisante de fiabilité (fichier potentiellement tronqué par manque d'espace disque, interruption, corruption). Un échec de `pg_restore --list` invalide la sauvegarde du jour, empêche la purge (décision 5), et est journalisé comme échec (décision 8).
   - **Mensuelle, réelle** : restauration effective (`pg_restore`) vers une base PostgreSQL dédiée et jetable, recréée pour l'occasion, jamais `lca_mes_dev`/`lca_mes_test`/la base de production. Contrôle d'intégrité par comptages sur un sous-ensemble de tables à enjeu métier (à titre d'exemple non exhaustif et non figé par cet ADR : `Lot`, `StockMovement`, `LotGenealogy`, `BatchCost`, `User`), comparés à un seuil de cohérence minimal (non nul / cohérent avec le dernier volume connu) — le détail exact des contrôles reste un choix d'implémentation, pas une décision métier bloquante.
   - Une procédure de restauration doit être **documentée par écrit** (hors du périmètre technique de cet ADR — livrable d'exploitation séparé), couvrant a minima : étapes de restauration, environnement cible jetable, critères de réussite explicites (code retour, `pg_restore --list`, comptages), horodatage de la dernière restauration réussie consigné.
7. **Comportement en cas d'échec** (voir détail par scénario en § Intégration) : à chaque étape, un échec est journalisé explicitement et interrompt le cycle **avant** toute purge — jamais de suppression forcée, jamais d'écrasement d'une sauvegarde valide par un résultat non vérifié.
8. **Alerting** : **aucun canal d'alerte automatique en V1**. Les échecs sont journalisés explicitement dans un fichier log local dédié (jamais de secret dans ce log). `FeedbackWebhookService`/Make n'est **pas réutilisé** pour ADM-11 — il reste scopé aux retours utilisateurs, son périmètre n'est pas étendu par cet ADR. Une absence prolongée de sauvegarde valide doit rester détectable **manuellement**, via consultation du log et de la procédure d'exploitation, tant qu'aucune décision d'alerting automatique n'est prise séparément.
9. **Sécurité des accès** : les identifiants PostgreSQL utilisés par le script ne sont jamais passés en argument de ligne de commande (visibles dans la liste des processus et les journaux du Planificateur de tâches) — mécanisme `.pgpass`/variable d'environnement du compte système exécutant la tâche. Aucun secret n'est commité dans Git, aucun secret n'apparaît dans les logs de sauvegarde.
10. **Périmètre applicatif** : aucun écran frontend, aucun module NestJS, aucune table Prisma, aucune migration. `ADM-11` reste un chantier d'infrastructure/scripts/configuration, entièrement hors du runtime applicatif LCA-MES.
11. **Limite explicitement assumée** : le stockage sur le disque local du serveur LCA **ne protège pas contre la perte, la panne matérielle ou la compromission du serveur lui-même** — un incident touchant le serveur (disque défaillant, incendie, vol, ransomware) affecterait simultanément la base de production et l'intégralité des 30 sauvegardes conservées localement. Cette limite est une conséquence directe et assumée de la décision 4 (stockage local, pas de cible externe au serveur) ; elle n'est pas résolue par cet ADR et doit être documentée comme telle dans toute communication sur la fiabilité des sauvegardes (voir § Conséquences).

## Raisons du choix

**Pourquoi le Planificateur de tâches Windows plutôt qu'un scheduler applicatif** : c'est le seul mécanisme de déclenchement périodique réellement disponible et cohérent avec l'infrastructure constatée — aucun `@nestjs/schedule`, aucun daemon cron, aucun orchestrateur, aucune CI/CD dans le dépôt. Coupler le déclenchement au cycle de vie du processus API (scheduler in-process) introduirait une dépendance à la disponibilité de l'application au moment prévu, moins fiable qu'une tâche planifiée au niveau du système d'exploitation.

**Pourquoi PowerShell plutôt que TypeScript** : décision explicite de l'utilisateur, motivée par la cohérence avec l'environnement Windows natif, le Planificateur de tâches Windows, et l'intention déjà documentée dans `docs/architecture.md` (`scripts/backup.ps1`) avant même cette tranche. Cet ADR l'acte formellement malgré l'absence de précédent PowerShell réel dans le dépôt à ce jour et l'absence d'outillage de test PowerShell (Pester) dans le projet — la logique de rotation/purge devra rester isolée dans une fonction dédiée pour rester revue et testable manuellement, faute d'infrastructure de test PowerShell.

**Pourquoi `pg_dump -Fc` plutôt qu'un dump SQL texte** : le format custom permet `pg_restore --list` comme vérification structurelle légère sans restauration complète (décision 6), la restauration sélective, et une compression native — sans étape de compression séparée à ajouter.

**Pourquoi le stockage local sur le serveur malgré la limite qu'il introduit** : décision explicite de l'utilisateur (pas un choix par défaut de l'architecture) — aucune infrastructure de stockage externe n'existe dans le projet à ce jour, et son introduction aurait constitué une nouvelle dépendance technique non démontrée comme nécessaire pour cette V1. La limite (décision 11) est documentée explicitement plutôt que masquée, conformément à la demande explicite de l'utilisateur.

**Pourquoi aucune table Prisma/`BackupLog`** : les mécanismes de journalisation applicative existants (`AuditLog`, `ImportLog`, `ExportLog`) sont tous structurellement conçus autour d'une action utilisateur authentifiée — un événement système déclenché par le Planificateur de tâches Windows, sans utilisateur authentifié et potentiellement sans processus NestJS actif, ne correspond à aucun de ces patrons. Créer une table pour un besoin non exprimé (aucun écran V1 ne consultera cette table) irait contre le principe déjà appliqué dans le projet de ne pas ajouter d'abstraction sans besoin démontré (voir ADR 0008 § Raisons du choix pour un raisonnement comparable).

## Intégration — comportement détaillé par scénario d'échec

Aucune écriture (staging, disque final, purge) n'est jamais partielle ou silencieuse :

| Scénario | Comportement |
|---|---|
| `pg_dump` échoue | Log explicite (horodatage, étape, message — jamais la chaîne de connexion), cycle interrompu, **aucune purge** ce jour. |
| Copie du staging vers le disque final du serveur échoue | Log explicite, fichier de staging conservé, **aucune purge**, dernière sauvegarde déjà validée reste la référence. |
| `pg_restore --list` échoue (sauvegarde corrompue) | Sauvegarde du jour marquée invalide, non comptée dans les 30 conservées, log explicite, **aucune purge** ce jour. |
| Purge d'anciennes sauvegardes échoue (ex. fichier verrouillé) | Log explicite ; ne remet pas en cause la sauvegarde du jour déjà acquise ; visible pour intervention manuelle. |
| Aucune sauvegarde valide depuis plusieurs jours | Aucune détection automatique proactive en V1 (décision 8) — détectable uniquement par consultation manuelle du log et de la procédure d'exploitation. |

## Conséquences

- **Aucune migration Prisma, aucune table, aucun module NestJS, aucun écran frontend** — confirmé par cet ADR (décision 10).
- **Prérequis d'exploitation** : les outils client PostgreSQL (`pg_dump`, `pg_restore`) doivent être installés sur le serveur exécutant le script — à vérifier/documenter au moment de l'implémentation, pas supposé acquis par cet ADR.
- **Limite de fiabilité assumée et documentée** (décision 11) : ce mécanisme protège contre une corruption logique de données, une erreur applicative ou humaine, mais **pas** contre la perte du serveur lui-même. Une protection contre ce second risque (copie hors site) resterait un chantier distinct, non cadré ici, à réévaluer si le besoin devient réel.
- **Fréquence de restauration mensuelle** et **absence d'alerting automatique** sont des choix de V1, révisables sans remettre en cause l'architecture retenue si l'usage réel en révèle le besoin.
- **DEBT-06 reste non résolue** par cet ADR — la conception reste compatible avec les deux modes de déploiement possibles (PostgreSQL conteneurisé ou natif) grâce au port déjà publié sur `127.0.0.1`, mais la validation en conditions réelles de production reste conditionnée à la résolution de DEBT-06 elle-même.
- **Documentation à mettre à jour séparément**, une fois l'implémentation réalisée : `PROJECT_STATE.md`, `MASTER_BACKLOG.md` (`ADM-11`), et confirmation ou correction de la mention `scripts/backup.ps1` dans `docs/architecture.md` — non fait par cet ADR (rédaction de l'ADR uniquement, aucun code).

## Alternatives envisagées et écartées

- **Scheduler applicatif (`@nestjs/schedule`)** : écarté — coupler le déclenchement au cycle de vie du processus API est moins fiable qu'une tâche planifiée au niveau du système d'exploitation, et introduit une dépendance non justifiée par rapport à l'existant (aucun scheduler applicatif dans le projet à ce jour).
- **Script TypeScript/`tsx`** : écarté par décision explicite de l'utilisateur malgré son statut de seul précédent réel de script autonome du dépôt — voir § Raisons du choix.
- **Stockage externe (NAS, cloud, S3, FTP)** : écarté pour cette V1 — décision explicite de l'utilisateur, aucune infrastructure de ce type existante ; la limite qui en découle (décision 11) est documentée plutôt que contournée par l'introduction d'une nouvelle dépendance technique non démontrée.
- **Table Prisma `BackupLog`** : écartée — voir § Raisons du choix.
- **Alerting automatique (réutilisation de `FeedbackWebhookService`/Make, ou nouveau canal)** : écarté pour cette V1 — décision explicite de l'utilisateur ; `FeedbackWebhookService` reste scopé aux retours utilisateurs, son périmètre n'est pas étendu par cet ADR.

## Risques connus

- **Perte simultanée de la base et des 30 sauvegardes en cas de sinistre serveur** (décision 11) — risque assumé explicitement, pas atténué par cet ADR, documenté pour ne jamais être présenté comme une protection qu'il n'offre pas.
- **Confiance excessive dans un simple code retour `pg_dump`** — atténué par la vérification `pg_restore --list` quotidienne et la restauration réelle mensuelle (décision 6), mais un risque résiduel de corruption non détectée entre deux restaurations réelles subsiste (fenêtre d'un mois).
- **Absence de détection automatique d'une panne de sauvegarde prolongée** (décision 8, assumée) — dépend d'une vérification manuelle périodique, cohérent avec le contexte à effectif réduit du laboratoire, à réévaluer si le besoin d'alerting automatique devient réel.
- **DEBT-06** (préexistante, non résolue) — le mode de déploiement réel de production n'étant pas encore validé en conditions réelles, la validation finale du script en production reste conditionnée à cette résolution, sans bloquer la conception ni l'implémentation de ce chantier.

## Références

- `MASTER_BACKLOG.md` — `ADM-11` (Jalon 4, priorité Haute), `DEBT-06`.
- `MASTER_SPECIFICATION.md` — fonctionnement on-premise, accès depuis le réseau local du laboratoire.
- `docs/architecture.md` — arborescence cible anticipant `scripts/backup.ps1` ; §7 sur le déploiement Docker Compose optionnel.
- `docker-compose.yml` — port `127.0.0.1:5432` déjà publié pour l'accès sauvegarde depuis le poste hôte.
- `apps/api/prisma/bootstrap-admin.ts` — seul précédent réel de script autonome hors NestJS du dépôt (référence écartée, voir § Alternatives).
- `apps/api/src/feedback/feedback-webhook.service.ts` — seul mécanisme de notification sortante existant, non réutilisé (voir § Alternatives).
- `docs/adr/0007-cout-par-flacon.md`, `docs/adr/0008-controle-qualite.md` — précédents directs de décisions structurantes actées par ADR après revue d'architecture et validation humaine explicite.
