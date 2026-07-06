# Modèle de données — LCA-MES V0.9

Ce document décrit les entités conceptuelles du modèle de données et leurs relations. Il sert de base à la définition du schéma Prisma (`apps/api/prisma/schema.prisma`), qui restera la source technique unique de vérité une fois le code créé.

Convention : toutes les entités listées ci-dessous portent implicitement un `id`, des dates `createdAt`/`updatedAt`, et une colonne `siteId` lorsque c'est pertinent (préparation multi-site, un seul site existant en V0.9).

## 1. Référentiel

### Site
Représente un site de production. Un seul enregistrement en V0.9.
- `nom`

### User
- `nom`, `email`, `motDePasseHash`
- `role` : enum `RESPONSABLE_LABORATOIRE` / `RESPONSABLE_ADJOINT` / `DIRECTION` / `DAF`
- `actif`

### Article
Table unique pour matières premières, packaging et produits finis, distingués par un type — évite la duplication de structure entre trois tables très similaires.
- `type` : enum `MATIERE_PREMIERE` / `PACKAGING` / `PRODUIT_FINI`
- `referenceOpenSi` (code article côté OpenSi, utilisé pour le rapprochement à l'import)
- `designation`
- `uniteDeMesure` (L, kg, unité...)
- `coutUnitaireCourant` (mis à jour par import ou saisie manuelle)
- `unitesParCarton` (optionnel — conditionnement en carton, **calcul d'affichage uniquement** : le stock reste compté en unités. Valeur libre par article, non figée en dur. Décision actée le 2026-07-06, voir `docs/roadmap.md` : flacons 10/30/50/100 ml → cartons de 100 ; flacons 200 ml → cartons de 36, à titre de suggestion par défaut)
- `densiteKgParL` (optionnel, matières premières uniquement — permet de calculer la masse à peser en préparation de batch à partir du volume, voir §4. Aucune valeur par défaut : si absente, seul le volume est affiché et une alerte "densité manquante" est montrée pour la masse. Décision actée le 2026-07-06, voir `docs/regles-metier.md` §12)
- `actif`

### Machine
- `nom` (ex : "CDA E-Fill 1", "CDA E-Fill 2", "Machine 30ml")
- `formatsSupportes` (ex : [50, 100, 200] ml)
- `actif`

## 2. Recettes

### Recipe (Recette)
- `produitFini` → FK `Article` (type = `PRODUIT_FINI`)
- `format` (ml)
- `version`
- `statut` : `ACTIVE` / `ARCHIVEE`

### RecipeLine (Ligne de recette)
- `recette` → FK `Recipe`
- `article` → FK `Article` (matière première ou packaging)
- `quantiteParUnite` (quantité nécessaire pour produire une unité du format concerné)
- `unite`

> Une recette utilisée dans un batch doit conserver une référence stable (version) afin qu'une modification ultérieure de la recette n'altère pas l'historique de production déjà enregistré.

## 3. Stocks

**Décision confirmée (2026-07-05) : le stock des matières premières et du packaging est suivi par lot de réception** (fût, seau...), et pas seulement en quantité globale par article — condition nécessaire à une vraie traçabilité amont (Jalon 3 : savoir quel lot fournisseur a servi à quel lot fini, pas seulement quel article).

### StockLot (Lot de réception)
Représente une réception physique (un fût, un seau, un carton de packaging...) avec sa propre quantité restante.
- `article` → FK `Article`
- `numeroLotFournisseur` (numéro de lot tel que fourni par le fournisseur/OpenSi à la réception)
- `quantiteRecue`
- `quantiteRestante` (décrémentée à chaque consommation ; source de vérité pour le FIFO/traçabilité)
- `dateReception`
- `datePeremption` (optionnelle)

### StockItem
Vue agrégée par article, dérivée de la somme des `StockLot.quantiteRestante` de cet article — évite de recalculer cette somme à chaque affichage.
- `article` → FK `Article`
- `quantiteDisponible` (= somme des `StockLot` actifs de l'article)
- `seuilMinimum` (stock de sécurité — **source unique de vérité**, non dupliquée dans `ExpectedRequirement`, voir §8)
- `estStockFaible` — dérivé, calculé côté serveur (`quantiteDisponible ≤ seuilMinimum`), `null` si aucun seuil n'est défini ; jamais recalculé côté client

### StockMovement (Mouvement de stock)
- `article` → FK `Article`
- `stockLot` → FK `StockLot` (optionnelle pour une `ENTREE` générique, obligatoire pour une `SORTIE_BATCH` — on doit toujours savoir de quel lot physique une sortie a été prélevée)
- `type` : enum `ENTREE` / `SORTIE_BATCH` / `AJUSTEMENT_INVENTAIRE` / `EXPORT_OPENSI`
- `quantite`
- `dateMouvement`
- `referenceBatch` → FK `Batch` (optionnelle, si liée à une production)
- `utilisateur` → FK `User`
- `commentaire`

> **Décision confirmée (2026-07-06)** : affectation FIFO (le lot reçu le plus anciennement est consommé en premier) pour la sélection des `StockLot` lors d'une consommation. Une évolution FEFO (basée sur `datePeremption`) est envisageable plus tard, non implémentée. Un ajustement d'inventaire (`AJUSTEMENT_INVENTAIRE`) **cible toujours un `StockLot` précis** (jamais un ajustement global par article), pour préserver l'invariant `StockItem.quantiteDisponible = Σ StockLot.quantiteRestante` — condition nécessaire à la fiabilité du FIFO et à la traçabilité.

## 4. Batching & production

**Décision confirmée (2026-07-06)**, voir `docs/regles-metier.md` §12 : le workflow réel de production comporte 4 étapes (préparation, mélange, incorporation en trémie, conditionnement), distinctes du statut global du batch. La quantité de chaque matière première (volume + masse si densité renseignée) et packaging nécessaire est calculée automatiquement à partir de la recette et de la quantité à produire (remplace le calcul auparavant fait dans un fichier Excel) — calcul à l'affichage, non stocké avant la clôture.

### Batch
- `recette` → FK `Recipe`
- `machine` → FK `Machine`
- `format` (hérité de la recette à la création, non ressaisi)
- `quantitePrevue`
- `quantiteProduite`
- `rebuts`
- `dateHeureDebut`, `dateHeureFin`
- `changementDeFormat` (booléen + détail optionnel)
- `statut` : `PLANIFIE` / `EN_COURS` / `TERMINE` / `ANNULE` — état global du batch
- `etapeCourante` (optionnelle) : enum `BatchStep` (`PREPARATION` / `MELANGE` / `INCORPORATION_TREMIE` / `CONDITIONNEMENT`), **champ distinct du statut** — indique où on en est dans le workflow réel. `null` tant que le batch n'a pas démarré. Progression stricte, un seul sens, aucun retour en arrière (V0.9). Seule l'étape courante est stockée, pas d'horodatage détaillé par étape.
- `utilisateurCreateur` → FK `User`

> La création d'un batch valide que la recette est `ACTIVE` et que la machine supporte le format de la recette (`Machine.formatsSupportes`).

### BatchStop (Arrêt de batch)
- `batch` → FK `Batch`
- `motif`
- `debut`, `fin`
- `dureeMinutes` (calculée automatiquement à la clôture de l'arrêt)

> Un seul arrêt peut être ouvert (`fin` nulle) à la fois pour un même batch.

## 5. Lots & traçabilité

### Lot
- `batch` → FK `Batch`
- `numeroLot` — généré par un service dédié (`LotNumberGeneratorService`), voir encadré ci-dessous
- `quantite` (quantité totale produite, rebuts inclus — cohérent avec `docs/regles-metier.md` §3/§5)
- `dateFabrication`
- `datePeremption` (optionnelle)
- `statutQualite` : enum `EN_ATTENTE` / `CONFORME` / `NON_CONFORME` / `BLOQUE`, calculé automatiquement à partir de l'ensemble des `QualityCheck` du lot (règle de calcul exacte à définir au Jalon 3, voir §6)

> **Génération du numéro de lot** : convention interne confirmée — 6 chiffres commençant par 455 (ex : `455XXX`), algorithme exact à préciser par l'utilisateur. Pour ne pas coder une règle figée, la génération est isolée dans un `LotNumberGeneratorService` dédié, appelé par le module `production` à la clôture du batch sans connaître le détail de l'algorithme. **Implémentation actuelle (temporaire, Phase D)** : compteur séquentiel par site (`455001`, `455002`...) — à remplacer par l'algorithme réel une fois fourni, sans impacter le reste du MES.
>
> **Point noté pour plus tard (2026-07-06)** : le numéro de lot n'est aujourd'hui renvoyé qu'immédiatement après la clôture (réponse de l'appel de clôture) — aucun endpoint ne permet encore de le relire en rechargeant un batch déjà terminé. À traiter avec le futur module `traceability` (Jalon 3), qui exposera la consultation des lots.

### LotGenealogy (Généalogie du lot)
Table centrale de traçabilité : permet de remonter d'un lot fini vers les lots de matières/packaging précis consommés pour le produire (traçabilité amont, voir §3).
- `lot` → FK `Lot`
- `articleConsomme` → FK `Article` (matière première ou packaging)
- `stockLotConsomme` → FK `StockLot` (le lot de réception précis consommé — permet un vrai rappel produit lot-à-lot)
- `quantiteConsommee`

> Chaque lot fini doit posséder au moins une ligne de généalogie avant d'être considéré comme "clôturé" — condition nécessaire pour garantir la capacité de rappel produit. La quantité totale généalogique (rebuts inclus) doit correspondre à la quantité totale déduite du stock (§3).
>
> **Implémenté (Phase D, 2026-07-06)** : à la clôture du batch, une ligne `LotGenealogy` est créée **par `StockLot` consommé** (pas par article) — si la sélection FIFO répartit la consommation d'un article sur plusieurs lots de réception, autant de lignes de généalogie sont créées pour cet article. Génération, déduction de stock (FIFO) et création du lot se font dans une seule transaction Prisma ; une rupture de stock sur un ou plusieurs articles annule l'ensemble (aucune écriture partielle), avec un message listant tous les articles manquants.

## 6. Qualité

**Décision confirmée (2026-07-05)** : un lot peut recevoir plusieurs contrôles qualité, chacun typé. La V0.9 n'utilisera peut-être qu'un seul contrôle en pratique, mais le modèle doit supporter plusieurs contrôles sans modification ultérieure.

### QualityCheck
- `lot` → FK `Lot`
- `type` : enum `VISUEL` / `ORGANOLEPTIQUE` / `PHYSICO_CHIMIQUE` / `PACKAGING` / `DOCUMENTAIRE`
- `resultat` : enum `CONFORME` / `NON_CONFORME` / `CONFORME_AVEC_RESERVE`
- `controleur` → FK `User`
- `dateControle`
- `commentaire`

### QualityCheckAttachment (Pièce jointe)
Architecture prévue dès la V0.9 (modèle présent), même si l'upload/stockage de fichier n'est pas nécessairement exploité immédiatement.
- `qualityCheck` → FK `QualityCheck`
- `nomFichier`
- `typeMime`
- `cheminStockage` (ou URL, selon la solution de stockage de fichiers retenue le moment venu)
- `dateAjout`

> **[À VALIDER — Jalon 3]** Règle exacte de calcul de `Lot.statutQualite` à partir de l'ensemble des `QualityCheck` du lot (ex : un seul `NON_CONFORME` suffit-il à bloquer le lot, ou faut-il une action explicite pour passer de `NON_CONFORME` à `BLOQUE` ?). À confirmer avec l'utilisateur au moment du Jalon 3.

## 7. Coûts

### BatchCost
Instantané du coût calculé au moment de la production (le coût unitaire des articles varie dans le temps ; ce figeage garantit un historique fiable).
- `batch` → FK `Batch`
- `coutMatierePremiereTotal`
- `coutPackagingTotal`
- `coutUnitaireParFlacon` (basé sur la quantité totale produite, rebuts inclus)
- `dateCalcul`

## 8. Besoins attendus (aide à la planification)

**Décision confirmée (2026-07-05)** : les « besoins attendus » importés d'OpenSi correspondent aux quantités à produire pour maintenir le stock de sécurité de chaque référence — ni un simple prévisionnel, ni uniquement des commandes clients. Le MES doit permettre d'afficher, par référence : stock actuel, stock minimum, quantité réservée, besoin calculé, quantité suggérée à produire. Le responsable laboratoire décide ensuite de lancer ou non un batch (aucune automatisation de déclenchement en V0.9).

### ExpectedRequirement (Besoin attendu)
- `article` → FK `Article` (généralement un produit fini)
- `quantiteReservee` (optionnelle, si fournie par OpenSi)
- `besoinImporte` (valeur telle que fournie par OpenSi, si le fichier l'inclut déjà calculée)
- `dateImport`

> **Décision confirmée (2026-07-06)** : pas de champ `stockMinimum` sur `ExpectedRequirement` — `StockItem.seuilMinimum` reste l'unique source de vérité du seuil de sécurité (voir §3), pour éviter toute divergence entre les deux entités.

> **[À VALIDER — Jalon 2]** Formule exacte de `besoinCalculé` et de `quantitéSuggérée` (ex : `besoinCalculé = max(0, seuilMinimum + besoinImporté − stockActuel − quantitéRéservée)`, `quantitéSuggérée` arrondie à la taille de lot standard de la recette ?). Ces deux valeurs sont **calculées à l'affichage** par un service dédié à partir de `ExpectedRequirement` + `StockItem`, pas stockées — à formaliser précisément avec l'utilisateur avant l'implémentation de l'écran correspondant.

## 9. Imports / exports OpenSi

### ImportLog
- `type` : `ARTICLES` / `STOCKS` / `BESOINS_ATTENDUS` / `INVENTAIRE`
- `nomFichier`
- `dateImport`
- `statut` : `PREVISUALISE` / `VALIDE` / `ERREUR`
- `nombreLignesTraitees`
- `nombreErreurs`
- `detailErreurs` (JSON optionnel, ex : `[{ "line": 4, "message": "..." }]`) — pour un historique consultable ligne par ligne, pas seulement un compteur
- `utilisateur` → FK `User`

### ExportLog
- `type` : `PRODUCTIONS` / `CONSOMMATIONS` / `MOUVEMENTS_STOCK` / `INVENTAIRES` / `RAPPORTS`
- `nomFichier`
- `dateExport`
- `utilisateur` → FK `User`

### ColumnMappingRule (moteur de mapping des connecteurs — voir ADR 0003)

Table générique, partagée par tous les connecteurs (OpenSi aujourd'hui, Magento/CRM/
fournisseurs/clients demain), pas seulement par les imports OpenSi. Mémorise les
corrections manuelles de mapping de colonnes validées par l'utilisateur, pour les
réutiliser automatiquement lors des imports suivants du même type.

- `site` → FK `Site`
- `source` (chaîne libre, ex : `"OPENSI"` — pas un enum, pour ne jamais exiger de
  migration à l'ajout d'un nouveau connecteur)
- `sourceVersion` (chaîne libre, ex : `"2026.1"`) — isole les règles apprises par version
  de format d'export de la source, pour qu'un futur changement de format côté connecteur
  (OpenSi, Magento...) ne réutilise jamais à tort une règle apprise sur l'ancien format.
  Si non fournie par l'appelant, `ColumnMappingService` applique par défaut la valeur
  `"default"` (constante `DEFAULT_SOURCE_VERSION`) — aucune valeur figée en base.
- `entityType` (chaîne libre, ex : `"ARTICLES"`, `"STOCKS"`...)
- `nomColonneNormalise` (nom de colonne du fichier, normalisé : minuscules, sans accents)
- `nomColonneOriginal` (dernière valeur brute observée, pour affichage)
- `fieldKey` (champ métier cible, ex : `"openSiReference"`)

Contrainte d'unicité : `(site, source, sourceVersion, entityType, nomColonneNormalise)`.
Une règle n'est enregistrée qu'à la **confirmation** d'un import, jamais à sa seule
prévisualisation.

## 10. Audit

### AuditLog
Journal technique, distinct de la traçabilité métier (`LotGenealogy`) : trace toute écriture sensible au niveau applicatif.
- `utilisateur` → FK `User`
- `action` (ex : `CREATE`, `UPDATE`, `DELETE`)
- `entite` (nom de l'entité modifiée)
- `entiteId`
- `donneesAvant` / `donneesApres` (JSON)
- `dateAction`

## 11. Schéma relationnel simplifié

```
Site 1──n User
Site 1──n Batch, Lot, StockMovement...

Article (type: MP / PACKAGING / PRODUIT_FINI)
  └─ référencé par RecipeLine, StockLot, StockItem, StockMovement, LotGenealogy, ExpectedRequirement

StockLot 1──n StockMovement
StockLot 1──n LotGenealogy (en tant que lot source consommé)

Recipe 1──n RecipeLine
Recipe 1──n Batch

Batch 1──n BatchStop
Batch 1──1 Lot
Batch 1──1 BatchCost
Batch 1──n StockMovement (sorties matières/packaging, quantité totale rebuts inclus)

Lot 1──n LotGenealogy
Lot 1──n QualityCheck

QualityCheck 1──n QualityCheckAttachment
```

## 12. Points ouverts à valider avec l'utilisateur

- Algorithme exact de génération du numéro de lot (convention confirmée : 6 chiffres commençant par 455, ex. `455XXX` — détail à fournir par l'utilisateur ; isolé dans `LotNumberGeneratorService`, voir §5).
- Règle exacte de calcul de `Lot.statutQualite` à partir des `QualityCheck` (Jalon 3, voir §6).
- Formule exacte de `besoinCalculé`/`quantitéSuggérée` (§8).

> Décisions confirmées le 2026-07-05 : les rebuts consomment le packaging au même titre que la matière première et sont inclus dans la quantité totale déduite du stock/généalogie (§3, §5) ; `BatchCost.coutUnitaireParFlacon` se calcule sur la quantité totale produite, rebuts inclus (§7) ; le stock est suivi par lot de réception pour permettre une traçabilité amont fine (§3) ; le contrôle qualité est multi-type dès la V0.9 (§6) ; les besoins attendus reflètent le maintien du stock de sécurité (§8).
>
> Décisions confirmées le 2026-07-06 : conditionnement en carton (`Article.unitesParCarton`, affichage uniquement, voir §1) ; affectation FIFO des `StockLot` confirmée comme règle par défaut, un ajustement d'inventaire cible toujours un `StockLot` précis (§3) ; `StockItem.seuilMinimum` est la source unique de vérité du seuil de stock (§3, §8, remplace l'ambiguïté précédente avec `ExpectedRequirement.stockMinimum`).
