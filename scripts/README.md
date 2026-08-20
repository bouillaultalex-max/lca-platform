# Sauvegardes automatiques PostgreSQL — ADM-11

Ce dossier contient le mécanisme de sauvegarde/restauration décrit par
`docs/adr/0009-sauvegardes-automatiques-postgresql.md`. Toute décision de conception (langage,
stockage, rétention, fréquence, alerting) est actée dans cet ADR — ce document ne couvre que la
procédure d'exploitation.

## Fichiers

| Fichier | Rôle |
|---|---|
| `backup.ps1` | Script principal, déclenché quotidiennement par le Planificateur de tâches Windows. `pg_dump -Fc` → staging → `pg_restore --list` → installation finale → rotation. |
| `restore.ps1` | Restauration d'un fichier de sauvegarde vers une base **jetable**. Utilisé pour le test mensuel de restauration et pour toute vérification manuelle ponctuelle. |
| `lib/BackupRotation.ps1` | Logique pure de nommage et de rétention (aucun accès disque/réseau), isolée pour rester testable sans Pester (absent du projet — voir ADR 0009, § Raisons du choix). |
| `lib/RestoreVerdict.ps1` | Classification pure (aucun accès disque/réseau) du résultat d'une restauration `pg_restore` en 3 états fermés (`Success` / `ManualReviewRequired` / `StructuralFailure`), utilisée par `restore.ps1` comme seule source de vérité pour le verdict affiché et le code de sortie. |
| `lib/ExternalTool.ps1` | Invocation d'un exécutable externe compatible `$ErrorActionPreference = 'Stop'` sous PowerShell 5.1 ; supporte une surcharge temporaire de variables d'environnement (`-EnvironmentOverrides`), utilisée par `restore.ps1` pour forcer `LC_ALL=C`/`LC_MESSAGES=C`/`LANG=C` sur l'appel `pg_restore` dont la sortie texte est analysée. |
| `tests/Test-BackupRotation.ps1` | Vérification de `lib/BackupRotation.ps1` par assertions manuelles (PASS/FAIL, code retour non nul en cas d'échec). Aucun framework de test introduit. |
| `tests/Test-RestoreVerdict.ps1` | Vérification de `lib/RestoreVerdict.ps1` (code réel, pas une copie) par assertions manuelles : restauration propre, erreurs ignorées, marqueur absent, comptage en échec, aucune table de contrôle, texte ambigu. Aucun accès disque/réseau. |
| `tests/Test-RestoreVerdictLocale.ps1` | Vérification empirique, contre une instance PostgreSQL réelle, que le marqueur analysé par `Get-RestoreVerdict` reste en anglais quelle que soit la locale ambiante du compte exécutant le script. S'auto-ignore (exit 0) si aucune instance PostgreSQL n'est disponible. |

## Prérequis

- Outils client PostgreSQL (`pg_dump`, `pg_restore`, `psql`, `createdb`, `dropdb`) installés sur
  le serveur qui exécute la tâche planifiée. Chemin par défaut des scripts :
  `C:\Program Files\PostgreSQL\18\bin` (paramètre `-PgBinPath` si différent).
- Le serveur PostgreSQL doit être accessible en TCP depuis le compte qui exécute la tâche
  planifiée (host/port fournis en paramètre ou via les variables d'environnement standard
  `PGHOST`/`PGPORT`/`PGUSER`).
- Un compte PostgreSQL disposant des droits de lecture sur la base à sauvegarder.

## Identifiants — jamais en ligne de commande (ADR 0009, décision 9)

`backup.ps1` et `restore.ps1` ne prennent **aucun paramètre de mot de passe**. Les outils
PostgreSQL (`pg_dump`, `pg_restore`, `psql`, `createdb`) résolvent le mot de passe eux-mêmes via
le mécanisme standard `libpq`, dans cet ordre de préférence :

1. Variable d'environnement `PGPASSWORD`, positionnée **uniquement** dans le contexte
   d'exécution de la tâche planifiée (jamais commitée, jamais dans un script).
2. Fichier `.pgpass` du compte Windows exécutant la tâche :
   `%APPDATA%\postgresql\pgpass.conf`, une ligne par règle :
   ```
   hostname:port:database:username:password
   ```
   Exemple pour la base de production (remplacer par les vraies valeurs au moment du
   déploiement) :
   ```
   localhost:5432:lca_mes:lca_mes:le-mot-de-passe-reel
   ```

Aucun secret n'apparaît jamais dans les journaux (`backup.log`) ni dans la liste des processus
Windows : `PGPASSWORD`, s'il est utilisé, n'est jamais passé en argument de commande.

## Installation (Planificateur de tâches Windows)

1. Copier ce dépôt (ou au minimum le dossier `scripts/`) sur le serveur qui héberge PostgreSQL.
2. Choisir et créer le répertoire de sauvegarde local sur ce même serveur (ADR 0009, décision 4 —
   jamais le poste développeur, jamais un stockage réseau/cloud). Ce chemin n'est pas fourni par
   ce dépôt : il doit être décidé et documenté au moment du déploiement réel.
3. Configurer les identifiants (`.pgpass` ou `PGPASSWORD`, voir ci-dessus) pour le compte Windows
   qui exécutera la tâche planifiée.
4. Créer une tâche planifiée quotidienne, hors des heures de production, exécutant :
   ```
   powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "<chemin>\scripts\backup.ps1" -PgDatabase "lca_mes" -BackupRoot "<répertoire de sauvegarde choisi à l'étape 2>"
   ```
   `-NonInteractive` est important : sans lui, un paramètre obligatoire manquant ferait attendre
   indéfiniment une saisie interactive impossible dans le contexte d'une tâche planifiée, au lieu
   d'échouer immédiatement avec un code retour non nul.
5. Configurer la tâche pour qu'un code retour non nul soit visible dans l'historique du
   Planificateur de tâches (comportement par défaut) — c'est aujourd'hui le seul mécanisme de
   détection d'échec (ADR 0009, décision 8 : aucune alerte automatique en V1).
6. Vérifier `backup.log` (dans le répertoire de sauvegarde) après la première exécution réelle.

## Procédure de restauration

### Restauration de test (mensuelle ou ponctuelle)

```
powershell.exe -NoProfile -NonInteractive -File "<chemin>\scripts\restore.ps1" `
    -BackupFile "<répertoire de sauvegarde>\lca_mes_20260818.dump" `
    -TargetDatabase "lca_mes_restore_test_20260818"
```

Étapes effectuées par le script :
1. Vérification structurelle (`pg_restore --list`) du fichier avant toute action.
2. Refus explicite si `-TargetDatabase` correspond à une base protégée
   (`lca_mes`, `lca_mes_dev`, `lca_mes_test`, `postgres`) — la restauration de test ne doit
   jamais écraser une base réelle.
3. Création de la base jetable (`createdb`).
4. Restauration (`pg_restore`).
5. Comptages indicatifs sur un sous-ensemble de tables à enjeu métier (`lots`,
   `stock_movements`, `lot_genealogies`, `batch_costs`, `users` — liste ajustable via
   `-CheckTables`, non exhaustive et non figée par l'ADR). Ces comptages sont **informatifs** :
   à comparer manuellement à un volume connu, pas un critère pass/fail automatique.
6. Par défaut, la base jetable est **conservée** pour inspection manuelle après restauration
   (commande de suppression affichée en fin d'exécution). Ajouter `-DropAfter` pour qu'elle soit
   supprimée automatiquement en fin de script.

### Critères de réussite d'un test de restauration

`restore.ps1` affiche un **VERDICT RESTAURATION** explicite parmi 3 états, déterminés par
`Get-RestoreVerdict` (`scripts/lib/RestoreVerdict.ps1`, voir § État de validation ci-dessous
pour le détail du mécanisme de classification et de sa correction du 2026-08-19) :
- **RÉUSSIE SANS AVERTISSEMENT** — code retour de `pg_restore` = 0. Seul état correspondant à
  un `exit 0` du script.
- **VÉRIFICATION MANUELLE OBLIGATOIRE** — `pg_restore` a signalé des erreurs individuelles
  ignorées (ex. objet déjà présent) mais a traité l'archive jusqu'au bout, et tous les comptages
  de contrôle configurés se sont exécutés sans erreur. **Ce n'est jamais un succès automatique** :
  un `COUNT(*)` qui s'exécute sans erreur prouve seulement que la table existe et que la requête
  est valide, jamais que les données attendues sont réellement présentes ou complètes (une table
  vidée par un `COPY` en échec compte tout aussi bien `0` sans lever d'erreur). L'opérateur doit
  comparer manuellement les comptages affichés à un volume connu avant de faire confiance à cette
  restauration. Le script sort en `exit 1` dans ce cas, précisément pour qu'aucune automatisation
  externe (Planificateur de tâches, script de supervision) ne l'interprète comme un succès sans
  cette vérification humaine.
- **ÉCHEC STRUCTUREL** — `pg_restore` n'a pas terminé le traitement de l'archive (marqueur natif
  absent, signe probable d'un arrêt prématuré), ou aucune table de contrôle n'est configurée
  (`-CheckTables` vide, aucune corroboration possible), ou au moins un comptage de contrôle a
  lui-même échoué (table absente ou requête en erreur) : traité comme un échec, sans exception.

Le **code de sortie du script** (`exit 0` / `exit 1`) reflète strictement cette classification —
`exit 0` uniquement pour **RÉUSSIE SANS AVERTISSEMENT**, `exit 1` pour les deux autres états, ou
si `-DropAfter` a échoué à nettoyer la base jetable. Un test de restauration mensuel n'est donc
concluant que si :
- Code retour `0` du script (les deux autres verdicts exigent une intervention humaine avant de
  pouvoir conclure quoi que ce soit), **et**
- Comptages cohérents avec le volume attendu au moment de la sauvegarde restaurée.
- **Consigner par écrit la date et le résultat de chaque restauration de test** (ex. dans un
  journal d'exploitation tenu séparément de ce dépôt) — ce dépôt fournit le mécanisme, pas le
  registre des exécutions passées.

### Test mensuel

Exécuter la procédure ci-dessus une fois par mois avec la sauvegarde la plus récente
(ADR 0009, décision 6). Aucun environnement de test dédié n'est supposé exister : la
restauration cible une base jetable sur la même instance PostgreSQL que la production, ou sur
une instance de test dédiée si une telle infrastructure existe et est documentée séparément.

## Vérification de la logique de rotation/rétention

```
powershell -NoProfile -File "<chemin>\scripts\tests\Test-BackupRotation.ps1"
```

Exécute des assertions manuelles (pas de Pester) sur `lib/BackupRotation.ps1` : nommage par
date calendaire, comportement à moins/exactement/plus de 30 sauvegardes, protection de la
sauvegarde la plus récente, gestion d'une double exécution le même jour, garde-fou de chemin
avant toute suppression. Code retour non nul si un scénario échoue.

## Vérification de la logique de classification d'une restauration

```
powershell -NoProfile -File "<chemin>\scripts\tests\Test-RestoreVerdict.ps1"
```

Exécute des assertions manuelles (pas de Pester) sur `lib/RestoreVerdict.ps1` — **le code réel**,
jamais une copie : restauration propre, erreurs ignorées avec comptages tous exécutables (jamais
un succès automatique, y compris en cas de perte de données réelle sur une table à enjeu), marqueur
de fin de traitement absent, comptage de contrôle en échec, aucune table de contrôle configurée,
texte de sortie ambigu (fail-closed). Aucun accès disque/réseau, exécutable sans instance
PostgreSQL. Code retour non nul si un scénario échoue.

```
powershell -NoProfile -File "<chemin>\scripts\tests\Test-RestoreVerdictLocale.ps1"
```

Vérification empirique complémentaire, **nécessitant une instance PostgreSQL réelle** (créé et
supprime une base jetable dédiée, préfixe `lca_mes_test_rv_locale_`) : confirme que le marqueur
natif `errors ignored on restore: N` reste en anglais, donc détectable par `Get-RestoreVerdict`,
même lorsque la locale ambiante du compte exécutant le script est configurée en français —
grâce à la surcharge `LC_ALL=C`/`LC_MESSAGES=C`/`LANG=C` appliquée par `restore.ps1` autour de
l'appel `pg_restore` concerné (`LC_ALL` inclus depuis la correction du 2026-08-20 — voir § État de
validation). S'auto-ignore (exit 0) si aucune instance PostgreSQL n'est disponible.

## Limite connue (ADR 0009, décision 11)

Le stockage étant local au serveur qui héberge aussi PostgreSQL, ce mécanisme protège contre une
corruption logique de données ou une erreur applicative/humaine, **pas** contre la perte du
serveur lui-même (panne disque, incendie, vol, ransomware). Une copie hors site resterait un
chantier distinct, non couvert ici.

## État de validation

### Correction du finding BLOQUANT (revue `pr-review-toolkit`, 2026-08-18)

Une revue croisée (`code-reviewer`, `pr-test-analyzer`, `type-design-analyzer`,
`silent-failure-hunter`) a identifié un défaut BLOQUANT : sous Windows PowerShell 5.1,
fusionner stderr via `2>&1` sur un appel natif alors que `$ErrorActionPreference='Stop'` est
actif transforme la moindre ligne stderr en exception terminante — y compris quand le processus
se termine réellement avec le code 0 — avant même la lecture de `$LASTEXITCODE`. `pg_restore
--list` (le contrôle anti-corruption central) et `pg_restore`/`psql` lors d'une restauration
(qui émettent couramment des avertissements bénins) étaient directement exposés.

**Correction** : `scripts/lib/ExternalTool.ps1` (nouveau, dot-sourcé par `backup.ps1` et
`restore.ps1`) isole chaque appel externe (`pg_dump`, `pg_restore`, `createdb`, `dropdb`,
`psql`) : `$ErrorActionPreference` est basculé sur `'Continue'` uniquement le temps de l'appel,
la décision de succès/échec repose exclusivement sur `$LASTEXITCODE`, jamais sur la seule
présence de stderr, et le contenu stderr reste journalisé. Vérifié empiriquement avant et après
application sur les scripts réels (voir ci-dessous) — un appel natif qui écrit sur stderr et
retourne 0 est bien traité comme un succès, un appel qui écrit sur stderr et retourne un code
non nul reste bien un échec avec le code réel préservé.

### Correction des 2 findings IMPORTANT (revue post-correction `pr-review-toolkit`, 2026-08-18)

**Finding IMPORTANT #1 — `restore.ps1` : critère de réussite incohérent avec le comportement
réel de `pg_restore`.** `pg_restore` ne distingue pas nativement, par son seul code retour, un
échec structurel d'un simple avertissement : par défaut, il continue au-delà des erreurs
individuelles (objet déjà présent, etc.) et retourne 1 dès qu'au moins une erreur a été
rencontrée, que l'archive ait été traitée jusqu'au bout ou non.

Investigation empirique menée avant toute correction, contre PostgreSQL local réel :
- **Restauration propre** (base jetable fraîchement créée, mêmes rôles source/cible) : code
  retour `0`, **aucune** sortie. Dans cet environnement de développement à rôle applicatif
  unique (`lca_mes` pour tout — source, création de base, restauration), le cas « avertissement
  de rôle/propriétaire absent » évoqué par le commentaire d'origine du code ne s'est **pas**
  produit naturellement : tous les objets du dump sont possédés par `lca_mes` (vérifié via
  `pg_restore --list`, 207/207 entrées), donc aucune divergence de propriétaire n'existe entre
  la base source et la base jetable cible. Ce cas reste néanmoins réel en toute généralité
  (restauration entre serveurs/rôles différents) — non exclu par la conception retenue.
- **Conflit d'objet réel provoqué** (type énuméré `article_type` pré-créé manuellement avant
  restauration) : `pg_restore` retourne le code `1`, avec le message natif exact :
  `pg_restore: error: could not execute query: ERREUR: le type « article_type » existe déjà`
  puis `pg_restore: warning: errors ignored on restore: 1`. Comptages de contrôle vérifiés
  après coup : identiques à une restauration propre (`lots=2`, `stock_movements=13`,
  `lot_genealogies=4`, `batch_costs=0`, `users=6`) — la restauration reste pleinement
  exploitable malgré le code retour non nul.
- **Échec réel provoqué** (base cible inexistante) : `pg_restore` retourne le code `1`, avec un
  message distinct (`connection ... failed: FATAL: la base de données ... n'existe pas`) et
  **sans** la ligne `errors ignored on restore` — l'archive n'a jamais été traitée.

**Décision retenue** (sans filtrage arbitraire de texte stderr) : la ligne native
`pg_restore: warning: errors ignored on restore: N` — imprimée par `pg_restore` uniquement
lorsqu'il a effectivement traité l'archive jusqu'au bout, erreurs individuelles comprises — sert
de signal de complétion. Combinée aux comptages de contrôle obligatoires (déjà présents), elle
permet une classification à 3 états, fail-closed :
1. **Échec structurel** : `pg_restore` n'a jamais atteint cette ligne de fin (arrêt prématuré),
   OU au moins un comptage de contrôle a lui-même échoué, OU aucune table de contrôle n'est
   configurée (`-CheckTables` vide, donc aucune preuve disponible).
2. **Réussie avec avertissements bénins** : la ligne de fin est présente ET tous les comptages
   de contrôle configurés ont réussi.
3. **Réussie sans avertissement** : code retour `0`.

`restore.ps1` affiche désormais un `VERDICT RESTAURATION` explicite parmi ces 3 états, puis un
`RÉSULTAT GLOBAL DU SCRIPT` combinant ce verdict et le résultat de `-DropAfter`. Le code de
sortie final (`exit 0`/`exit 1`) est maintenant strictement cohérent avec le verdict affiché.

Vérifications empiriques post-correction, contre PostgreSQL local réel :
- Restauration propre via `restore.ps1` (sans `-DropAfter`) : `VERDICT RESTAURATION : RÉUSSIE
  SANS AVERTISSEMENT.`, `exit 0`.
- Restauration propre via `restore.ps1` avec `-DropAfter` : verdict identique, suppression de la
  base jetable confirmée, `exit 0`.
- Échec réel de `dropdb` provoqué (connexion active maintenue sur la base jetable par un
  processus séparé pendant l'exécution de `restore.ps1 -DropAfter`) : restauration elle-même
  réussie (`VERDICT RESTAURATION : RÉUSSIE SANS AVERTISSEMENT.`), mais `dropdb` échoue avec un
  message réel (`la base de données ... est en cours d'utilisation par d'autres utilisateurs`),
  correctement journalisé, `RÉSULTAT GLOBAL DU SCRIPT : ÉCHEC (exit 1)` — la distinction entre
  « restauration réussie » et « nettoyage échoué » reste explicite dans la sortie.
- Le cas « avertissements bénins » et le cas « échec structurel » n'ont pas pu être reproduits
  à travers `restore.ps1` de bout en bout dans cet environnement à rôle unique (le script crée
  systématiquement une base jetable vierge via `createdb`, sans objet préexistant pouvant entrer
  en conflit). *Précision méthodologique* : la logique de classification elle-même (code exact
  et expression régulière de `restore.ps1`, copiés verbatim) a été exécutée isolément contre les
  deux transcripts réels ci-dessus (conflit d'objet et échec de connexion) ainsi que contre des
  variantes fail-closed (comptage en échec, aucune table de contrôle configurée) : les 5
  classifications obtenues correspondent exactement au comportement attendu.

**Finding IMPORTANT #2 — `backup.ps1` : garde-fou `-MinFreeSpaceMB` jamais exercé.**

Vérifié réellement le 2026-08-18 : `backup.ps1` lancé avec `-MinFreeSpaceMB 999999999` (très
supérieur à l'espace réellement disponible, 97575 Mo constatés sur le disque de test). Résultat
réel :
- Log : `[ERROR] Espace disque insuffisant sur le lecteur C: (97575 Mo libres, minimum requis
  999999999 Mo). Sauvegarde abandonnée avant tout pg_dump.`
- Code de sortie du script : `1`.
- **Aucun** appel à `pg_dump` n'a eu lieu (absent du log, absent de la trace d'exécution).
- **Aucun** fichier `.dump` produit dans le répertoire de sauvegarde.
- **Aucune** purge déclenchée (le script s'arrête avant d'atteindre cette section).

### Correction de 3 findings IMPORTANT complémentaires (revue post-correction `pr-review-toolkit`, 2026-08-19)

Une seconde revue croisée post-correction (mêmes 4 rôles) a challengé directement le mécanisme
retenu ci-dessus pour le finding IMPORTANT #1 et a trouvé 3 nouveaux findings IMPORTANT, tous
corrigés. **Les états « RÉUSSIE AVEC AVERTISSEMENTS BÉNINS » et la garantie « confirmé par les
comptages de contrôle » décrits dans la section précédente n'existent plus** : ils sont remplacés
par ce qui suit.

**Finding IMPORTANT A — un `COUNT(*)` qui s'exécute sans erreur ne prouve jamais que les données
sont réellement présentes.** Le mécanisme précédent pouvait classer une restauration « RÉUSSIE
AVEC AVERTISSEMENTS BÉNINS » (`exit 0`) dès lors que `pg_restore` avait ignoré des erreurs et que
les `COUNT(*)` sur les tables de contrôle s'exécutaient sans erreur — sans jamais regarder si ces
comptages reflétaient des données réellement restaurées. Reproduit empiriquement : une table
`lots` pré-créée avec un schéma incompatible fait échouer le `COPY` de ses lignes lors de la
restauration (la table reste vide) ; `pg_restore` retourne 1 avec `errors ignored on restore: 11`
; `SELECT COUNT(*) FROM lots` **réussit** (exit 0) et retourne `0` — l'ancien mécanisme aurait
classé cette restauration « bénigne », alors que la table de généalogie de lot venait de perdre
toutes ses données.

**Correction** : `Get-RestoreVerdict` (`scripts/lib/RestoreVerdict.ps1`, fonction pure extraite de
`restore.ps1` — voir aussi finding C) ne promeut plus jamais automatiquement une restauration en
succès dès lors que `pg_restore` a ignoré des erreurs, quels que soient les résultats des
comptages de contrôle. Le seul état possible dans ce cas est désormais
**VÉRIFICATION MANUELLE OBLIGATOIRE** (`exit 1`, voir § Critères de réussite ci-dessus) — jamais
un succès automatique. Reproduit avec la fonction réelle (pas une copie) contre le même scénario
de perte de données : `lots=0` (perte confirmée), comptage exécutable (`CountFailureCount=0`),
verdict obtenu `ManualReviewRequired`, `ExitCode=1` — plus de faux succès.

**Finding IMPORTANT B — le marqueur `errors ignored on restore: N` est un texte localisé, pas
stable sans intervention.** Vérifié empiriquement en A/B réel (même conflit d'objet, deux
locales ambiantes) : `LANG=en_US.UTF-8` produit `pg_restore: warning: errors ignored on
restore: N` (regex matche) ; `LANG=fr_FR.UTF-8` produit `pg_restore: attention : erreurs
ignorées lors de la restauration : N` (regex **ne matche pas**). Sur un serveur en locale
française (cas réel probable du serveur de production), l'état « bénin »/« vérification
manuelle » aurait été **inatteignable** : toute restauration avec erreurs ignorées aurait été
classée à tort ÉCHEC STRUCTUREL. Sens sûr (pas de faux succès) mais neutralisait l'intention du
mécanisme.

**Correction** : `scripts/lib/ExternalTool.ps1` accepte désormais un paramètre optionnel
`-EnvironmentOverrides` (variables d'environnement positionnées puis restaurées autour de l'appel
externe, même principe que la bascule de `$ErrorActionPreference` déjà en place). `restore.ps1`
force `LC_ALL=C`/`LC_MESSAGES=C`/`LANG=C` uniquement pour l'appel `pg_restore` dont la sortie est
analysée — aucun autre appel (`pg_restore --list`, `createdb`, `dropdb`, `psql`) n'est concerné,
aucun parseur multilingue introduit. Vérifié empiriquement contre PostgreSQL local réel
(`tests/Test-RestoreVerdictLocale.ps1`) : le marqueur anglais reste présent que la locale ambiante
soit positionnée en français ou en anglais.

**Correction complémentaire (revue post-correction `pr-review-toolkit`, 2026-08-20)** : la
première version de ce correctif ne forçait que `LC_MESSAGES`/`LANG`, sans `LC_ALL`. Or en
résolution de locale POSIX/gettext, `LC_ALL` a priorité sur `LC_MESSAGES` et `LANG` : un compte
dont l'environnement ambiant positionne `LC_ALL` (ex. locale française) aurait continué à
produire un marqueur localisé malgré la surcharge, neutralisant le correctif ci-dessus dans ce
cas précis (sens sûr : fail-closed, `StructuralFailure` au lieu de `ManualReviewRequired` — jamais
un faux succès, mais un diagnostic trompeur). Vérifié empiriquement : avec l'ancienne surcharge à
2 clés, un ambiant `LC_ALL=fr_FR.UTF-8` produit toujours `erreurs ignorées lors de la
restauration : N` (regex ne matche pas) ; avec la surcharge à 3 clés ci-dessus (`LC_ALL` inclus),
le marqueur anglais reste stable même sous cet ambiant. `tests/Test-RestoreVerdictLocale.ps1`
positionne désormais `LC_ALL` (en plus de `LANG`/`LC_MESSAGES`) dans l'environnement ambiant
simulé, pour qu'une régression sur ce point précis soit détectée automatiquement.

**Finding IMPORTANT C — la logique de classification n'avait aucun test automatisé committé.**
Elle vivait en ligne dans `restore.ps1`, entrelacée avec les appels `createdb`/`pg_restore`/`psql`,
non exécutable en test sans dupliquer le code (ce qu'avait fait la revue précédente pour la
valider manuellement, hors dépôt). Une régression future n'aurait été détectée qu'au test mensuel
suivant, au mieux.

**Correction** : la classification est désormais une fonction pure sans aucune dépendance
disque/réseau, `Get-RestoreVerdict` (`scripts/lib/RestoreVerdict.ps1`), à la manière de
`lib/BackupRotation.ps1`. `restore.ps1` l'appelle une seule fois et dérive uniquement d'elle le
texte affiché (`switch` sur `$restoreVerdict.State`) et le code de sortie final
(`$restoreVerdict.ExitCode`) — aucune re-dérivation indépendante ailleurs dans le script.
`tests/Test-RestoreVerdict.ps1` exerce cette fonction réelle (pas une copie) sur 8 scénarios
(17 assertions) : restauration propre, erreurs ignorées avec comptages exécutables (y compris le
scénario de perte de données du finding A), marqueur absent, comptage en échec, aucune table de
contrôle, texte ambigu proche du marqueur, sortie vide.

**Vérifications empiriques post-correction, contre PostgreSQL local réel :**
- `tests/Test-BackupRotation.ps1` : 28/28 PASS (aucune régression).
- `tests/Test-RestoreVerdict.ps1` : 17/17 PASS (fonction réelle, tous les scénarios listés
  ci-dessus).
- `tests/Test-RestoreVerdictLocale.ps1` : 2/2 PASS (marqueur anglais stable sous locale ambiante
  française et anglaise).
- Restauration propre de bout en bout via `restore.ps1 -DropAfter` (script complet, pas
  seulement la fonction) : `VERDICT RESTAURATION : RÉUSSIE SANS AVERTISSEMENT.`, `exit 0`,
  comptages identiques aux vérifications précédentes (`lots=2`, `stock_movements=13`,
  `lot_genealogies=4`, `batch_costs=0`, `users=6`).
- Scénario de perte de données du finding A rejoué avec les fonctions réelles
  (`Invoke-ExternalTool`/`Get-RestoreVerdict`, orchestrées à l'identique de `restore.ps1` — le
  script complet ne permet pas de pré-créer un conflit sur la base jetable qu'il crée lui-même) :
  `lots=0` (perte confirmée), `VERDICT... State=ManualReviewRequired ExitCode=1
  IgnoredErrorCount=11` — plus de faux succès.
- Aucun appel natif (`pg_dump`, `pg_restore`, `createdb`, `dropdb`, `psql`) ne contourne
  `Invoke-ExternalTool` dans `backup.ps1`, `restore.ps1`, ou les nouveaux fichiers de test
  (vérifié par recherche systématique).
- Analyse statique PowerShell (`Parser]::ParseFile`) sans erreur sur tous les fichiers touchés,
  sous Windows PowerShell 5.1 réel. BOM UTF-8 présent sur tous les fichiers modifiés/créés
  (convention déjà en place dans ce dossier).
- Toutes les bases jetables et fichiers temporaires créés pour ces vérifications ont été
  supprimés après vérification ; aucun secret (mot de passe, `PGPASSWORD`) trouvé dans les
  sorties produites.

### Composants vérifiés en environnement de développement (PostgreSQL natif local, base `lca_mes_dev`)

- **Logique de rotation/rétention** : 28 assertions automatisées (`Test-BackupRotation.ps1`),
  toutes passantes — incluant, depuis la correction du 2026-08-18, une vérification par
  **identité** (pas seulement par nombre) du cas « rétention à 1 », une déduplication de dates
  avec effet observable au-dessus du seuil de rétention, des noms de fichiers presque valides
  (7/9 chiffres, casse), et l'insensibilité à la casse voulue de `Test-PathIsWithinDirectory`.
- **`backup.ps1`** : exécution réelle réussie (`pg_dump` → `pg_restore --list` → installation),
  y compris le cas d'une deuxième exécution le même jour calendaire (remplacement contrôlé,
  jamais de doublon), avec la version corrigée (`Invoke-ExternalTool`).
- **`restore.ps1`** : restauration réelle réussie vers une base jetable, comptages de contrôle
  cohérents, refus vérifié d'une base protégée en cible, suppression de la base jetable
  (`-DropAfter`) désormais vérifiée par code retour (auparavant non contrôlée).
- **`pg_restore --list`** vérifié séparément, en ligne de commande directe, sur une sauvegarde
  réelle produite par `backup.ps1` : code retour 0, contenu structurel cohérent (210 entrées TOC).

### Les 5 scénarios d'échec de l'ADR (§ Intégration), exercés réellement le 2026-08-18

1. **`pg_dump` échoue** : `backup.ps1` lancé avec un nom de base inexistant, contre le vrai
   serveur PostgreSQL local. Résultat réel : `pg_dump` retourne le code 1 avec un message
   stderr réel (« la base de données ... n'existe pas »), correctement capturé par
   `Invoke-ExternalTool`, log `[ERROR]` explicite, code de sortie du script = 1, **aucun**
   fichier `.dump` produit. C'est le scénario exact que corrige le finding BLOQUANT.
2. **Copie staging → destination échoue** : fichier de destination du jour verrouillé par un
   processus distinct (job PowerShell séparé tenant un handle exclusif) pendant l'exécution
   réelle de `backup.ps1` (avec `pg_dump`/`pg_restore --list` réels et réussis). Résultat réel :
   `Move-Item` échoue, log `[ERROR]` explicite, fichier de staging conservé pour analyse,
   **aucune purge**, code de sortie = 1.
3. **`pg_restore --list` échoue (corruption)** : une sauvegarde réelle a été tronquée au tiers
   de sa taille, puis passée à la fonction réelle `Invoke-ExternalTool` avec exactement les
   mêmes appels que dans `backup.ps1` (code identique, dot-sourcé depuis le vrai
   `scripts/lib/ExternalTool.ps1`). Résultat réel : `pg_restore --list` retourne le code 1 avec
   un message stderr réel (« could not read from input file: end of file »), correctement
   capturé sans crash, branche d'échec déclenchée. *Précision méthodologique* : ce test exerce
   la fonction réelle et le code réel de la branche de validation, mais pas le script
   `backup.ps1` de bout en bout (aurait nécessité de truquer `pg_dump` lui-même) — le reste du
   flux (aucune promotion, aucune purge) est identique au code déjà validé de bout en bout au
   scénario 1.
4. **Une purge échoue** : 31 fichiers de sauvegarde factices datés (2026-06-01 → 2026-07-01)
   créés dans le répertoire de sauvegarde, le plus ancien (2026-06-01) verrouillé par un
   processus distinct, puis `backup.ps1` exécuté réellement (nouvelle sauvegarde réelle du jour
   incluse). Résultat réel : le fichier verrouillé échoue à la suppression (log `[WARN]`
   explicite), mais le fichier suivant à purger (2026-06-02) est bien supprimé malgré cet échec
   (poursuite avec les fichiers suivants, correction du finding « purge partielle »), résumé
   `Purge terminée : 1/2 sauvegarde(s) supprimée(s), 1 échec(s).` journalisé, cycle marqué en
   échec (`[ERROR]`, code de sortie = 1) bien que la sauvegarde du jour soit acquise.
5. **Absence de sauvegarde valide pendant plusieurs jours** : conformément à l'ADR (décision 8),
   aucune détection automatique n'est attendue en V1. Vérifié à la place : 3 cycles consécutifs
   en échec réel (nom de base inexistant) produisent 3 lignes `[ERROR]` horodatées consécutives
   dans le log, sans aucune ligne de succès entre elles — un opérateur consultant manuellement
   le log verrait immédiatement l'absence de cycle réussi récent. *Précision* : simulation par
   échecs répétés au sein d'une même session, pas par une attente réelle de plusieurs jours
   calendaires.

Pour chacun des 5 scénarios : code retour vérifié, contenu du log vérifié, absence de purge
dangereuse vérifiée, comportement conforme à l'ADR 0009 § Intégration confirmé. Aucun secret
(mot de passe, `PGPASSWORD`) n'a été trouvé dans les logs produits par ces tests (vérifié par
recherche systématique après chaque scénario). Tous les répertoires de test et bases jetables
créés pour ces validations ont été supprimés après vérification.

### Restent à faire sur le serveur réel de production

Hors de portée de cet environnement de développement : choix et création du répertoire de
sauvegarde définitif, configuration réelle des identifiants (`.pgpass`), création de la tâche
planifiée, première exécution en conditions réelles, premier test de restauration mensuel en
conditions réelles.
