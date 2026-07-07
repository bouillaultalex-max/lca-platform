# Règles métier — LCA-MES V0.9

Les règles marquées **[À VALIDER]** sont des propositions raisonnables faites en l'absence de précision explicite ; elles doivent être confirmées ou ajustées avec l'utilisateur avant implémentation définitive.

## 1. Rôles et permissions

- `RESPONSABLE_LABORATOIRE` et `RESPONSABLE_ADJOINT` disposent d'un accès complet : création, modification, suppression sur tous les modules.
- `DIRECTION` et `DAF` sont strictement en lecture seule, limités aux rapports, statistiques, coûts, stocks et tableaux de bord. Aucun accès aux écrans de saisie/édition (catalogue, batching, imports...).
- Toute action de création/modification/suppression est journalisée dans `AuditLog` avec l'identité de l'utilisateur.

## 2. Traçabilité (généalogie des lots)

- **Un lot fini ne peut pas être considéré comme "clôturé" tant qu'il ne possède pas au moins une ligne de généalogie (`LotGenealogy`)** reliant le lot aux matières premières et packaging consommés. Cette règle garantit la capacité de rappel produit.
- La généalogie est générée automatiquement à partir de la recette du batch (quantité produite × quantités unitaires de la recette), et reste modifiable manuellement en cas d'écart réel constaté (ex : consommation supplémentaire suite à un incident).
- Une recette utilisée dans un batch conserve sa version au moment de l'utilisation : une modification ultérieure de la recette ne doit **jamais** altérer rétroactivement la généalogie ou le coût d'un batch déjà clôturé.

## 3. Stock

- Les mouvements de stock (`StockMovement`) sont le seul moyen de faire évoluer `StockItem.quantiteDisponible` — jamais de modification directe de la quantité disponible sans mouvement associé.
- La clôture d'un batch génère automatiquement les sorties de stock (matières premières + packaging) correspondant à la généalogie du lot produit.
- **Décision confirmée (2026-07-05)** : les rebuts (unités rejetées après remplissage) consomment le packaging associé (flacon, bouchon, étiquette) **en plus** de la matière première. Un flacon rempli puis rejeté est considéré comme ayant intégralement consommé le liquide, la bouteille, le bouchon et l'étiquette utilisés jusqu'à ce stade. La déduction de stock et la généalogie (`LotGenealogy`) doivent donc couvrir la quantité **totale** produite (conforme + rebuts), pas seulement la quantité conforme.
- Un ajustement d'inventaire (écart constaté physiquement) doit toujours être saisi comme un `StockMovement` de type `AJUSTEMENT_INVENTAIRE`, jamais comme une correction silencieuse.
- **Décision confirmée (2026-07-05)** : le stock des matières premières et du packaging est suivi par lot de réception (`StockLot` — fût, seau, carton...), pas seulement en quantité globale par article. Toute sortie de stock (`SORTIE_BATCH`) doit identifier précisément le `StockLot` consommé, condition nécessaire à une vraie traçabilité amont (rappel produit lot-à-lot, voir §2). **[À VALIDER]** Règle d'affectation quand plusieurs lots sont disponibles pour un même article : proposition par défaut FIFO (premier reçu, premier consommé).

## 4. Numérotation des lots

- **Décision confirmée (2026-07-05)** : LCA Distribution a déjà une convention interne de numérotation à conserver impérativement — un numéro à 6 chiffres commençant par 455 (ex : `455XXX`). L'algorithme exact de génération (incrémentation, remise à zéro, règles de collision...) sera fourni par l'utilisateur après vérification de leur fonctionnement actuel.
- **Contrainte d'implémentation explicite** : ne pas coder de logique de génération figée. La génération du numéro de lot doit être isolée dans un service dédié (`LotNumberGeneratorService`), appelé par le module `production` sans que celui-ci connaisse le détail de l'algorithme — pour pouvoir changer la règle plus tard sans impacter le reste du MES.
- Le numéro de lot est généré automatiquement à la clôture du batch et n'est jamais modifiable manuellement.

## 5. Coût par flacon

- Le coût par flacon (`BatchCost.coutUnitaireParFlacon`) est calculé à partir des coûts unitaires courants des articles de la recette au moment de la clôture du batch, puis **figé définitivement** (une évolution ultérieure du coût unitaire d'un article n'affecte pas les coûts déjà calculés).
- **Décision confirmée (2026-07-05)** : le coût unitaire par flacon se calcule en divisant le coût total (matière première + packaging) par la **quantité totale produite, rebuts inclus** (et non par la seule quantité conforme). Les rebuts font partie du coût réel de production et doivent être supportés par le coût unitaire, cohérent avec la règle de consommation de packaging par les rebuts (voir §3).

## 6. Contrôle qualité

- **Décision confirmée (2026-07-05)** : un lot peut recevoir **plusieurs** contrôles qualité (`QualityCheck`), chacun typé parmi `VISUEL` / `ORGANOLEPTIQUE` / `PHYSICO_CHIMIQUE` / `PACKAGING` / `DOCUMENTAIRE`. Chaque contrôle porte une date/heure, un contrôleur, un statut (`CONFORME` / `NON_CONFORME` / `CONFORME_AVEC_RESERVE`), un commentaire et des pièces jointes éventuelles (architecture prévue dès la V0.9, upload non nécessairement exploité immédiatement).
- La V0.9 pourra n'utiliser qu'un seul contrôle en pratique, mais **le modèle doit permettre plusieurs contrôles sans modification** (voir `docs/modele-donnees.md` §6).
- Le lot possède un statut global calculé automatiquement à partir de l'ensemble de ses contrôles : `EN_ATTENTE` / `CONFORME` / `NON_CONFORME` / `BLOQUE`.
- **[À VALIDER — Jalon 3]** Règle exacte de calcul de ce statut global (ex : un seul contrôle `NON_CONFORME` suffit-il à passer le lot en `NON_CONFORME` ? Le passage à `BLOQUE` est-il automatique ou nécessite-t-il une action explicite d'un responsable ?) et : un lot `NON_CONFORME`/`BLOQUE` doit-il bloquer automatiquement toute sortie de stock ultérieure (export OpenSi, expédition) ? À confirmer avec l'utilisateur au moment du Jalon 3.

## 7. Imports OpenSi

- Tout import de fichier (articles, références, stocks, besoins attendus, inventaire) doit systématiquement passer par une **prévisualisation** affichant les créations/modifications prévues, avant toute écriture en base.
- Chaque import est journalisé (`ImportLog`) avec le fichier, la date, l'utilisateur, le nombre de lignes traitées et le nombre d'erreurs, que l'import soit validé ou abandonné après prévisualisation.
- Un import en erreur partielle (certaines lignes invalides) ne doit jamais bloquer l'intégralité de l'import : les lignes valides sont proposées à la validation, les lignes en erreur sont listées explicitement.
- **Décision confirmée (2026-07-06)** : la reconnaissance des colonnes d'un fichier importé est automatique (variantes d'intitulés, colonnes surnuméraires ignorées), mais toujours **explicable** — chaque colonne reconnue affiche pourquoi, chaque champ obligatoire non trouvé est signalé avant toute prévisualisation métier. L'utilisateur peut toujours corriger le mapping proposé ; une correction validée à la confirmation d'un import est mémorisée et réutilisée automatiquement lors des imports suivants du même type, pour que les imports demandent de moins en moins d'intervention avec le temps. Ce mécanisme (voir ADR 0003) est volontairement simple et sans IA opaque, et **rien n'est jamais écrit en base tant que le mapping n'est pas validé**.

## 8. Besoins attendus

- **Décision confirmée (2026-07-05)** : les besoins attendus importés d'OpenSi correspondent aux quantités à produire pour maintenir le stock de sécurité de chaque référence (ni un simple prévisionnel, ni uniquement des commandes clients).
- Le MES affiche, par référence : stock actuel, stock minimum, quantité réservée, besoin calculé, quantité suggérée à produire. Ces deux dernières valeurs sont **calculées à l'affichage**, pas stockées (voir `docs/modele-donnees.md` §8).
- Aucune automatisation de déclenchement de production en V0.9 : le responsable laboratoire décide seul de lancer ou non un batch à partir de ces informations.
- **[À VALIDER — Jalon 2]** Formule exacte de `besoinCalculé` et de `quantitéSuggérée`, à confirmer avec l'utilisateur avant l'implémentation de l'écran correspondant.

## 9. Exports OpenSi

- Les exports (productions terminées, consommations matières, mouvements de stock, inventaires, rapports) sont générés à la demande et journalisés (`ExportLog`).
- Un export n'a pas d'effet de bord sur les données de LCA-MES : il ne fait que lire et formater les données existantes.

## 10. Multi-site (préparation)

- Toute entité créée en V0.9 porte une référence `siteId`, même si un seul site existe. Aucune fonctionnalité de gestion multi-site (sélection de site, permissions par site) n'est développée en V0.9 : c'est une préparation de modèle, pas une fonctionnalité livrée.

## 11. Sauvegardes

- Une sauvegarde automatique (`pg_dump`) de la base est exécutée quotidiennement, avec une politique de rétention/rotation à définir avec l'utilisateur (proposition par défaut : conservation glissante sur 30 jours + copie hebdomadaire sur un support externe).
- La procédure de restauration doit être testée et documentée avant toute mise en production réelle.

## 12. Workflow réel de préparation/batching/production

**Décision confirmée (2026-07-06)**, validée avec le responsable laboratoire — workflow réel actuel :
1. Consultation des besoins.
2. Adaptation des quantités à produire, par gamme, avec un **objectif de couverture d'environ 1 mois ou plus** de besoin (pas un flux tendu à la demande).
3. Préparation de la recette du produit à batcher selon la quantité nécessaire — **faite aujourd'hui manuellement via des fichiers Excel**.
4. Batching (préparation/pesée des matières premières et packaging selon la recette).
5. Mélange du produit.
6. Incorporation du produit dans la trémie de la machine.
7. Conditionnement (remplissage des flacons par la machine).

Conséquences pour LCA-MES :
- **Le logiciel doit remplacer progressivement les fichiers Excel de préparation de batch** : à partir de la recette (matières premières en %, packaging en quantité absolue par unité, voir `docs/modele-donnees.md` §2) et de la quantité à produire, le module `batching` doit **calculer automatiquement** la quantité de chaque ingrédient/packaging nécessaire.
- **Le module `production` doit distinguer 4 étapes** plutôt qu'un unique statut "en cours" : préparation/batching, mélange, incorporation en trémie, conditionnement machine. **Décision confirmée (2026-07-06)** : ces étapes sont modélisées par un champ dédié `Batch.currentStep` (enum `BatchStep`), **distinct** du statut global `Batch.status` (`BatchStatus`) — le statut indique l'état global du batch (planifié/en cours/terminé/annulé), l'étape indique où on en est dans le déroulement de la production. Pour la V0.9, seule l'étape courante est stockée ; les horodatages détaillés par étape pourront être ajoutés plus tard si nécessaire, non anticipés maintenant.
- **Aucune étape de maturation dans le processus réel — ne pas en prévoir en V0.9.**
- La planification de la production doit s'appuyer sur les **besoins par gamme** (regroupement de produits), pas uniquement par référence individuelle prise isolément — vient s'ajouter aux besoins attendus déjà actés (§8), formule exacte encore à préciser (voir aussi le point ouvert sur `besoinCalculé`/`quantitéSuggérée`).

### Calcul des quantités de préparation (volume et masse)

**Décision confirmée (2026-07-06)** : les recettes expriment la composition des matières premières en **pourcentage de volume** (voir §2 modèle de données — règle des 100 % déjà en place depuis le Jalon 2). En production, le laboratoire a besoin à la fois du **volume** et de la **masse à peser** de chaque matière première. Formules retenues, pour une quantité à produire donnée :

- `volumeTotalL = format(mL) × quantitéÀProduire ÷ 1000`
- `volumeIngrédientL = volumeTotalL × pourcentage ÷ 100`
- `masseIngrédientKg = volumeIngrédientL × densité(kg/L)` — **uniquement si une densité est renseignée** pour l'article concerné.

Conséquences :
- Nouveau champ **`Article.densityKgPerL`** (optionnel, matières premières uniquement) : densité en kg par litre, saisie manuelle article par article. **Aucune valeur par défaut codée en dur** — si la densité n'est pas renseignée pour un article, le logiciel affiche uniquement le volume et signale explicitement "densité manquante" pour la masse (jamais une masse silencieusement fausse ou une valeur par défaut arbitraire).
- Le calcul de masse **ne s'applique pas au packaging** (quantité déjà exprimée en unités absolues, pas de notion de volume/masse à convertir).
- Cette règle reste volontairement simple pour la V0.9 : pas de gestion avancée de conversion (température, viscosité...), pas de densité "type" par famille de produit codée en dur.

## 13. Gestion des utilisateurs (Jalon 2.5)

- **Fonction métier (`JobTitle`) distincte du rôle logiciel (`role`)** : la fonction métier est une entité dédiée (pas un texte libre), un utilisateur en a exactement une. Elle sert à terme au tableau de bord personnalisé, aux statistiques par fonction, à de futures communications internes — elle n'accorde aucune permission par elle-même.
- **Administrateur système (`isSystemAdmin`) indépendant du rôle logiciel** : gérer les comptes utilisateurs (créer, modifier, désactiver, réinitialiser un mot de passe) est une capacité orthogonale aux 4 rôles métier existants (`RESPONSABLE_LABORATOIRE`/`RESPONSABLE_ADJOINT`/`DIRECTION`/`DAF`), pas un 5e rôle. Seul un administrateur système peut gérer les utilisateurs.
- **Mots de passe** : jamais stockés en clair (bcrypt, coût 12). Un mot de passe temporaire n'est retourné qu'une seule fois, au moment de sa création (création de compte ou réinitialisation), jamais journalisé dans `AuditLog`.
- **Compte désactivé** : la connexion est immédiatement refusée, sans exception. Un administrateur système ne peut pas désactiver son propre compte (pour éviter un verrouillage accidentel).
- **Première connexion / mot de passe temporaire** : `mustChangePassword` bloque tout endpoint hors `GET /auth/me` et `POST /auth/change-password` tant que le mot de passe n'a pas été changé.
- **`LoginHistory` distinct d'`AuditLog`** : `AuditLog` reste réservé aux actions métier (création/modification/désactivation de compte...) ; `LoginHistory` enregistre chaque tentative de connexion (réussie ou non), avec email, IP et navigateur si disponibles — sert de base à une détection d'anomalies future, non construite en V0.9.
- **Amorçage** : le tout premier administrateur système est créé par un script dédié (`prisma/bootstrap-admin.ts`, distinct du `seed.ts` de développement), puisque l'écran d'administration exige déjà un administrateur pour être utilisé. Les comptes suivants sont créés par cet administrateur via l'écran Administration.
