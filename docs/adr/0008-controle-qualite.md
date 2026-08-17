# ADR 0008 — Contrôle qualité par lot (`QualityCheck`, QUA-01/QUA-03)

## Statut

Accepté — 2026-08-17. Revue d'architecture (`alex-architecte`) conclue **« Approuvé sous conditions »**, 6 conditions posées puis validées humainement le même jour (voir § Décisions ci-dessous) — aucun code écrit avant cette validation.

## Contexte

Le livrable du Jalon 3 (`docs/roadmap.md`) inclut explicitement le « contrôle qualité simple ». `docs/regles-metier.md` §6 et `docs/modele-donnees.md` §6 posent depuis le 2026-07-05 le principe d'un contrôle qualité multi-type par lot (`QualityCheck`), mais laissaient ouverte la règle exacte de calcul du statut global du lot (`Lot.qualityStatus`) — référencée comme `DEBT-03` dans `MASTER_BACKLOG.md` (*« Règle exacte de calcul du statut qualité global du lot à partir des `QualityCheck` — À valider, bloque QUA-03 »*).

Après l'achèvement de PRD-10 (coût par flacon, ADR 0007), un arbitrage PO a comparé deux candidats pour la tranche suivante — le frontend R&D/Aromathèque (backend déjà livré, tranche 1) et le module Qualité (QUA-01/02/03, non démarré) — et a tranché en faveur de Qualité : c'est le seul élément explicitement nommé dans la définition textuelle du MVP fin août 2026 encore entièrement absent, alors que `Lot.qualityStatus` (champ déjà présent dans `schema.prisma`, enum `LotQualityStatus`) n'est aujourd'hui jamais écrit par aucun service et reste figé à `EN_ATTENTE` pour tout lot clôturé.

Une revue d'architecture (`alex-architecte`) a ensuite examiné le cadrage fonctionnel V1 validé par l'utilisateur (QUA-01 inclus, QUA-03 inclus avec une règle volontairement simple, QUA-02 reporté) et a rendu un avis **« Approuvé sous conditions »** : l'architecture proposée (entité enfant de `Lot`, sur le modèle déjà établi par `BatchCost`/ADR 0007) est cohérente avec l'existant, mais plusieurs points restaient à trancher explicitement par l'utilisateur avant tout développement — c'est l'objet de cet ADR.

## Problème

Quatre questions restaient ouvertes à l'issue de la revue d'architecture, chacune bloquante pour au moins une partie de l'implémentation :

1. La règle de calcul du statut global fournie par l'utilisateur (« un seul `NON_CONFORME` bloque, sinon `CONFORME` si des contrôles conformes existent, sinon `EN_ATTENTE` ») ne précisait pas le traitement du résultat `CONFORME_AVEC_RESERVE`.
2. `LotQualityStatus` possède une valeur `BLOQUE` que la règle fournie ne produit jamais — fallait-il la retirer, ou la conserver pour un usage futur ?
3. Aucune correction ni suppression de `QualityCheck` n'étant prévue en V1, un `NON_CONFORME` enregistré par erreur rendrait le lot durablement `NON_CONFORME`, sans mécanisme de rattrapage — ce caractère définitif devait être explicitement assumé ou ajusté.
4. `AuditLog` n'est aujourd'hui branché que sur la gestion des comptes (`user-admin`) ; ni `BatchClosureService` ni `BatchCostsService`/ADR 0007 n'y écrivent, malgré `docs/regles-metier.md` §1 (*« Toute action de création/modification/suppression est journalisée dans `AuditLog` »*). Fallait-il suivre ce précédent (aucune écriture) ou commencer à combler l'écart pour `QualityCheck` ?

## Décisions

1. **Traitement de `CONFORME_AVEC_RESERVE`** : compatible avec `CONFORME` pour le calcul du statut global. La règle de calcul de `Lot.qualityStatus` est :
   - si au moins un `QualityCheck` du lot a pour résultat `NON_CONFORME` → `Lot.qualityStatus = NON_CONFORME` ;
   - sinon, si au moins un `QualityCheck` existe (et qu'aucun n'est `NON_CONFORME`, qu'il soit `CONFORME` ou `CONFORME_AVEC_RESERVE`) → `Lot.qualityStatus = CONFORME` ;
   - si aucun `QualityCheck` n'existe encore pour le lot → `Lot.qualityStatus = EN_ATTENTE`.
   Aucun scoring, aucune pondération, aucun calcul complexe. `CONFORME_AVEC_RESERVE` n'a donc pas d'effet distinct de `CONFORME` sur le statut global en V1 — la réserve reste visible au niveau du `QualityCheck` individuel (champ `result`), mais n'est pas répercutée séparément sur `Lot.qualityStatus`.
2. **`BLOQUE` conservé dans `LotQualityStatus`**, mais **jamais produit automatiquement** par le calcul du statut en V1 — aucune combinaison de `QualityCheck` ne peut y mener. Cette valeur reste réservée à une évolution métier future (ex. action manuelle explicite d'un responsable, hors périmètre de cet ADR).
3. **`QualityCheck` immuable en V1** : aucun endpoint `PATCH`, aucun `DELETE`, aucune correction automatique. Conséquence assumée : dès qu'un `QualityCheck` de résultat `NON_CONFORME` est enregistré sur un lot, `Lot.qualityStatus` devient `NON_CONFORME` et le reste pour ce lot en V1, y compris si le contrôle initial était une erreur de saisie — aucun contrôle ultérieur, quel que soit son résultat, ne peut compenser un `NON_CONFORME` déjà enregistré (la règle du point 1 réévalue l'ensemble des contrôles, mais un `NON_CONFORME` présent dans cet ensemble y reste pour toujours). Cette irréversibilité est **volontaire** et documentée comme une limite acceptée de la V1 (voir § Risques connus), pas un défaut à corriger.
4. **Permissions** : écriture (`POST` de création d'un `QualityCheck`) réservée à `@Roles(...FULL_ACCESS_ROLES)` (`RESPONSABLE_LABORATOIRE`, `RESPONSABLE_ADJOINT`) — cohérent avec `docs/regles-metier.md` §1 (`DIRECTION`/`DAF` strictement en lecture seule, aucun accès aux écrans de saisie/édition) et avec le seul patron d'écriture existant dans le projet (`BatchClosureController`). Lecture (consultation du statut global et des contrôles d'un lot) ouverte à tout utilisateur authentifié, sans `@Roles`, y compris `DIRECTION`/`DAF` — même patron que `TraceabilityController`/`BatchCostsController` (ADR 0007). Aucun rôle supplémentaire introduit.
5. **`siteId` dérivé du `Lot` racine** : pas de colonne `siteId` propre sur `QualityCheck` — même convention que `LotGenealogy`/`BatchStop`/`BatchCost` (ADR 0007), entité enfant toujours accédée via son `Lot` (`{ lotId, lot: { siteId } }`), jamais interrogée indépendamment.
6. **`AuditLog` appliqué à la création d'un `QualityCheck`** — périmètre strictement limité à cette écriture ; **aucune refonte globale du système `AuditLog`** n'est entreprise par cet ADR (les autres modules déjà en écart avec `docs/regles-metier.md` §1, ex. `batch-closure`/`costing`, restent en l'état, hors périmètre).
7. **QUA-02 (pièces jointes) hors périmètre V1** : aucune infrastructure de stockage de fichiers, aucun upload persistant, aucune nouvelle dépendance de stockage. Le modèle `QualityCheckAttachment` documenté dans `docs/modele-donnees.md` §6 (« architecture prévue dès la V0.9 ») reste une intention documentaire non implémentée — il n'est ni créé, ni retiré de la documentation par cet ADR.

## Raisons du choix

**Pourquoi `CONFORME_AVEC_RESERVE` traité comme `CONFORME`** : la règle fournie par l'utilisateur est explicitement volontairement simple (« aucun scoring, aucune pondération »). Introduire un troisième état intermédiaire pour le statut global aurait réintroduit une forme de gradation que la décision écarte explicitement. La nuance reste néanmoins consultable : elle n'est pas perdue, seulement non répercutée sur l'agrégat `Lot.qualityStatus`.

**Pourquoi `BLOQUE` reste dans l'enum sans être produit** : le retirer casserait la compatibilité si la valeur était déjà utilisée manuellement en base, et fermerait une extension future (action manuelle de blocage) sans qu'aucune raison métier actuelle ne justifie sa suppression. Le conserver comme valeur inerte en V1 est sans coût et réversible.

**Pourquoi l'immutabilité malgré le risque d'erreur de saisie** : cohérent avec le principe déjà appliqué à `LotGenealogy`, `StockMovement` et `BatchCost` (ADR 0007) — aucune correction/suppression de données de traçabilité ou de coût une fois écrites. Un mécanisme de correction encadrée (ex. futur QUA-04) reste un chantier distinct, non cadré ici, plutôt qu'une complexité ajoutée dans cette tranche sous la pression du calendrier MVP.

**Pourquoi `AuditLog` sur `QualityCheck` malgré le précédent `BatchCost` (qui n'y écrit pas)** : `QualityCheck` est une écriture métier nouvelle et sensible (elle peut bloquer durablement un lot, de façon irréversible en V1, voir décision 3) — l'utilisateur a tranché explicitement en faveur de la traçabilité de cette action plutôt que de reconduire silencieusement l'écart déjà constaté sur `batch-closure`/`costing`. Cette décision ne constitue pas une remise à niveau générale du système d'audit (voir § Conséquences) : elle ne s'applique qu'à `QualityCheck`.

**Pourquoi `QualityCheck` en `siteId` dérivé, pas en colonne propre** : même raisonnement que `BatchCost` (ADR 0007) — entité enfant systématiquement accédée via son `Lot`, aucune requête métier plausible ne nécessite de lister des `QualityCheck` sans passer par leur `Lot` (et donc par `lot.siteId`).

## Modèle de données retenu

Aucun modèle Prisma créé par cet ADR — à formaliser dans une migration additive ultérieure. Champs validés :

- **`QualityCheckType`** (enum) : `VISUEL` / `ORGANOLEPTIQUE` / `PHYSICO_CHIMIQUE` / `PACKAGING` / `DOCUMENTAIRE` — reprend exactement l'énumération déjà documentée dans `docs/modele-donnees.md` §6 depuis le 2026-07-05, non modifiée par cet ADR.
- **`QualityCheckResult`** (enum) : `CONFORME` / `NON_CONFORME` / `CONFORME_AVEC_RESERVE` — distinct de `LotQualityStatus` (qui possède `EN_ATTENTE`/`BLOQUE` en plus, absents du résultat d'un contrôle unitaire) ; ne pas réutiliser `LotQualityStatus` pour ce champ.
- **`QualityCheck`** :
  - `lot` → FK `Lot`, relation `1──n` (un lot peut recevoir plusieurs contrôles, y compris de même type — aucune contrainte d'unicité `(lotId, type)`, un recontrôle après action corrective reste possible).
  - `type` → `QualityCheckType`.
  - `result` → `QualityCheckResult`.
  - `controller` → FK `User` (contrôleur ayant réalisé le contrôle).
  - `checkedAt` → date/heure du contrôle réalisé.
  - `comment` → commentaire libre, optionnel.
  - `createdAt`/`updatedAt` → horodatage technique standard.
  - Pas de `siteId` propre (voir décision 5).
  - Indexé sur `lotId` (recherche directe des contrôles d'un lot).
- **`QualityCheckAttachment`** : non créé (décision 7).
- **`Lot`** : ajout d'une relation inverse `qualityChecks` (`QualityCheck[]`) ; `qualityStatus` (`LotQualityStatus`, déjà existant depuis l'origine du modèle `Lot`) devient pour la première fois réellement écrit par un service.

## Règle de calcul du statut global (QUA-03) et intégration

Fonction pure et testable (sur le modèle de `computeBatchCost`, ADR 0007), recevant l'ensemble des résultats des `QualityCheck` d'un lot et retournant le `LotQualityStatus` selon la règle de la décision 1. Aucun accès base dans cette fonction — la logique de lecture/écriture reste dans le service.

Flux de création d'un `QualityCheck` (transaction Prisma unique, indépendante de `BatchClosureService` — le contrôle qualité est réalisé après coup, à tout moment suivant la clôture, jamais de façon synchrone à celle-ci) :

1. Résoudre le lot par `{ id: lotId, siteId: user.siteId }` (404 sinon, même garde que `TraceabilityService`/`BatchCostsService`).
2. Dans la transaction : créer le `QualityCheck` ; relire l'ensemble des `QualityCheck` du lot (celui qui vient d'être créé inclus) ; recalculer `Lot.qualityStatus` via la fonction pure et l'écrire.
3. Journaliser la création dans `AuditLog` (`action: CREATE`, `entity: 'QualityCheck'`, `entityId`, `after` contenant les champs créés) — décision 6.
4. Retourner le `QualityCheck` créé (et le `Lot.qualityStatus` à jour).

## Conséquences

- **Migration Prisma additive requise** (non réalisée par cet ADR) : deux nouveaux enums (`QualityCheckType`, `QualityCheckResult`), une nouvelle table `QualityCheck` (FK `Lot`, FK `User`, index sur `lotId`), une relation inverse sur `Lot`. Aucune modification de colonne existante — `Lot.qualityStatus`/`LotQualityStatus` existent déjà et n'évoluent pas structurellement pour cette règle.
- **Aucun backfill** : les lots déjà clôturés avant l'implémentation de QUA-01/03 conservent `qualityStatus = EN_ATTENTE` (valeur par défaut déjà en base) — cohérent avec le principe déjà retenu pour PRD-10/PRD-11 (aucune modification rétroactive des données historiques).
- **Tests attendus** : couverture unitaire de la fonction pure de calcul du statut (cas `EN_ATTENTE`/`CONFORME`/`NON_CONFORME`/mélange `CONFORME`+`CONFORME_AVEC_RESERVE`/ordre d'insertion sans effet) ; tests unitaires du service (mocks Prisma, création + recalcul transactionnel, 404 hors site, écriture `AuditLog`) ; tests e2e (cloisonnement site, permissions en écriture réservées à `FULL_ACCESS_ROLES`, lecture ouverte y compris `DIRECTION`/`DAF`, absence de routes `PATCH`/`DELETE`). Logique classée « à risque métier » selon `CLAUDE.md` (statut qualité pouvant bloquer durablement un lot) — couverture non facultative.
- **Limite assumée** : un `QualityCheck` erroné (mauvais type/résultat saisi par erreur) ne peut pas être corrigé en V1 ; le lot concerné reste `NON_CONFORME` de façon permanente si le résultat erroné était `NON_CONFORME`. Un mécanisme de correction encadrée resterait un chantier distinct (ex. futur QUA-04), non cadré par cet ADR.
- **Limite assumée** : `AuditLog` reste appliqué de façon ponctuelle (`user-admin` + désormais `QualityCheck`), pas de façon systématique à toutes les écritures sensibles du projet malgré `docs/regles-metier.md` §1 — cet écart documentation/code préexistant n'est pas résorbé par cet ADR au-delà du périmètre `QualityCheck`.
- **QUA-02 reste un chantier distinct**, non cadré, à reprendre lorsque la stratégie de stockage de fichiers (disque local, base, service externe) aura fait l'objet d'une décision d'architecture dédiée.
- **Frontend** : aucun écran n'existe aujourd'hui pour créer un `QualityCheck` ni consulter l'historique des contrôles d'un lot (`TraceabilityPage.tsx` affiche déjà `Lot.qualityStatus` en lecture seule, sans point d'entrée pour le détail). Un écran reste structurellement nécessaire pour que QUA-01/03 soit exploitable en pratique — conception non couverte par cet ADR, ticket frontend distinct.

## Alternatives envisagées et écartées

- **`CONFORME_AVEC_RESERVE` comme état distinct du statut global** (ex. un nouveau statut `Lot.qualityStatus` intermédiaire, ou une gradation) : écarté — contredit explicitement la consigne « aucun scoring, aucune pondération, aucun calcul complexe » de la décision 1.
- **Suppression de `BLOQUE` de `LotQualityStatus`** : écartée — aucune justification métier actuelle, fermerait une extension future sans bénéfice, risque de rupture si la valeur est déjà utilisée manuellement.
- **Endpoint de correction/suppression d'un `QualityCheck` en V1** : écarté — hors périmètre explicitement validé (immutabilité V1, décision 3), cohérent avec le principe déjà appliqué à `LotGenealogy`/`StockMovement`/`BatchCost`.
- **Refonte globale du système `AuditLog`** pour combler l'écart avec `docs/regles-metier.md` §1 sur tous les modules existants : écartée — hors périmètre explicitement délimité à `QualityCheck` par la décision 6 ; les écarts déjà connus sur `batch-closure`/`costing` restent non traités par cet ADR.
- **Implémentation de `QualityCheckAttachment` en V1** : écartée — nécessiterait une décision d'architecture inédite (stratégie de stockage de fichiers, absente du projet à ce jour), hors périmètre du cadrage validé (QUA-02 reporté).

## Risques connus

- **Erreur de saisie irréversible** : un `QualityCheck` `NON_CONFORME` créé par erreur bloque durablement le lot en `NON_CONFORME`, sans mécanisme de correction en V1 (gravité moyenne — un lot durablement bloqué peut empêcher une expédition —, probabilité moyenne dans un contexte de saisie manuelle par un effectif réduit). Risque assumé explicitement par la décision 3 ; mesure de réduction recommandée côté futur écran de saisie (confirmation avant enregistrement d'un `NON_CONFORME`), sans solution technique imposée par cet ADR.
- **Concurrence sur le recalcul** : deux créations quasi simultanées de `QualityCheck` sur le même lot pourraient, en isolation `read committed` (niveau par défaut, déjà utilisé sans changement par `BatchClosureService`), présenter un état transitoire incohérent si les transactions se chevauchent exactement. Gravité et probabilité faibles au regard du contexte réel (2 utilisateurs actifs) — mesure retenue : relecture complète des `QualityCheck` du lot dans la même transaction que l'insertion (déjà intégrée au flux décrit ci-dessus), pas de passage à un niveau d'isolation supérieur (cohérent avec la même logique de prudence qu'ADR 0007 § Risques connus).
- **Écart documentaire préexistant, non résolu par cet ADR** : `MASTER_SPECIFICATION.md` §4.6 et `docs/architecture.md` §3 décrivent encore un contrôle qualité binaire simple (conforme/non conforme), formulation obsolète face à `docs/regles-metier.md` §6/`docs/modele-donnees.md` §6 (modèle multi-type à 3 résultats, confirmé le 2026-07-05 et repris par `MASTER_BACKLOG.md` QUA-01). Ces deux documents plus anciens ne font pas foi sur ce point et devront être mis à jour séparément ; cet ADR ne les corrige pas.

## Références

- `docs/regles-metier.md` §1 (rôles/permissions, journalisation `AuditLog`), §6 (contrôle qualité — décision confirmée le 2026-07-05).
- `docs/modele-donnees.md` §6 (`QualityCheck`, `QualityCheckAttachment`, point ouvert `DEBT-03`).
- `MASTER_BACKLOG.md` — QUA-01, QUA-02, QUA-03 (Epic 06/Jalon 3), `DEBT-03`.
- `docs/roadmap.md` — Jalon 3, livrable « contrôle qualité simple ».
- `CLAUDE.md` — traçabilité et journal d'audit non négociables ; tests obligatoires sur la logique à risque métier.
- `docs/adr/0007-cout-par-flacon.md` — précédent architectural direct (entité enfant de `Lot`, pas de `siteId` propre, permissions lecture ouverte/écriture réservée, calcul isolé dans une fonction pure).
- `apps/api/src/audit-log/audit-log.service.ts` — état actuel du journal d'audit (limité à `user-admin` avant cet ADR).
- `apps/api/prisma/schema.prisma` — `enum LotQualityStatus`, `Lot.qualityStatus` (existant, jamais écrit avant cet ADR).
- `MASTER_SPECIFICATION.md` §4.6, `docs/architecture.md` §3 — formulation obsolète (contrôle qualité binaire), en écart avec `docs/regles-metier.md` §6 (voir § Risques connus).
