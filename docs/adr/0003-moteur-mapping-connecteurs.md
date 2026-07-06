# ADR 0003 — Moteur générique de mapping de colonnes pour les connecteurs

## Statut

Accepté — 2026-07-06

## Contexte

Le Jalon 2 doit permettre d'importer des fichiers Excel/CSV OpenSi (articles, stocks,
besoins attendus, inventaire) même quand leurs colonnes ne correspondent pas exactement
aux noms attendus (variantes d'intitulés, colonnes surnuméraires). Un premier découpage
envisageait un mapping codé uniquement pour les imports OpenSi.

Décision utilisateur (2026-07-06) : ne pas construire ce mécanisme comme une brique
spécifique à OpenSi, mais comme le **moteur commun de tous les futurs connecteurs**
(imports Magento, CRM, fournisseurs, clients, exports, API...), avec deux exigences fortes :

1. Le mapping doit **s'améliorer avec l'usage** : une correction manuelle de l'utilisateur
   doit être mémorisée par site, par source externe et par type d'entité, et réutilisée
   automatiquement lors des imports suivants du même type.
2. Le cœur du moteur ne doit **jamais connaître de concept métier** (aucune mention
   d'"article", "stock", "OpenSi"...) : il ne connaît qu'une source, une configuration
   générique, des règles de mapping et des règles apprises. Les synonymes, champs attendus
   et validations métier restent dans des fichiers de configuration séparés, propres à
   chaque module consommateur.

## Décision

1. **Modèle de persistance** (`prisma/schema.prisma`) : `ColumnMappingRule`, avec les
   champs `siteId`, `source` (chaîne libre, ex. `"OPENSI"`), `sourceVersion` (chaîne libre,
   ex. `"2026.1"` — voir point 7), `entityType` (chaîne libre, ex. `"ARTICLES"`),
   `columnNameNormalized`, `columnNameOriginal`, `fieldKey`. Contrainte d'unicité
   `(siteId, source, sourceVersion, entityType, columnNameNormalized)`. `source` et
   `entityType` sont des chaînes et non des enums Prisma : ajouter un nouveau connecteur ne
   demande jamais de migration de schéma.
2. **Emplacement du moteur** : `apps/api/src/common/column-mapping/` — un dossier
   d'infrastructure partagée (au même titre que `common/`, `config/`, `prisma/` déjà
   existants), **pas** un module métier de la liste de `docs/architecture.md` §3. Il expose
   `ColumnMappingService` via un `ColumnMappingModule` importable par n'importe quel module
   consommateur. Aucun fichier de ce dossier ne référence un champ, une entité ou un
   fournisseur métier précis.
3. **Configurations métier séparées** : chaque module consommateur (aujourd'hui
   `import-export`) définit ses propres fichiers de configuration (`mapping-configs/`) :
   liste des champs attendus (`fieldKey`, libellé, obligatoire ou non, synonymes). Le moteur
   consomme cette configuration en paramètre, sans jamais la connaître à l'avance.
4. **Algorithme de correspondance** : normalisation du texte (minuscules, accents et
   ponctuation supprimés) puis trois règles explicites, dans cet ordre — correspondance
   exacte (score 100), partielle/contenue (score 75), sinon un score continu dérivé de la
   distance de Levenshtein (0 à 100). Seuil d'acceptation automatique : 50. En dessous de
   30, une ressemblance n'est même plus mentionnée. Entre 30 et 49, elle n'est jamais
   affectée automatiquement mais peut apparaître comme piste (« correspondance faible »)
   si elle concerne un champ obligatoire resté sans correspondance et que sa colonne n'a
   pas été utilisée ailleurs. Attribution gloutonne en cas de conflit entre deux champs sur
   une même colonne (meilleur score en premier). Volontairement simple et traçable : pas de
   bibliothèque de similarité floue tierce, pas de modèle statistique ou d'IA.
5. **Apprentissage** : une règle n'est enregistrée qu'au moment où un import est
   **confirmé** (jamais à la simple prévisualisation), pour ne pas mémoriser une correction
   saisie puis abandonnée. Lors des imports suivants, une colonne dont le nom normalisé
   correspond à une règle apprise est affectée directement (confiance 100, avant même le
   calcul de score par synonymes).
6. **Aucune coercition de valeur dans le moteur** : `applyToRows()` ne fait que projeter
   `data[nomColonne] → valeur` sous la clé `fieldKey`, sans interpréter ni convertir la
   valeur. Le typage attendu (`type` dans la configuration) reste une information
   descriptive ; la validation et la conversion réelles restent entièrement dans les
   services métier de chaque module (comme c'était déjà le cas pour les DTO existants).
7. **Version de connecteur** (décision confirmée le 2026-07-06, en complément du reste de
   cet ADR) : un changement de format d'export côté source (ex. OpenSi publie un nouveau
   format d'export en 2027) ne doit jamais faire réutiliser à tort une règle apprise sur
   l'ancien format. `sourceVersion` fait donc pleinement partie de la portée d'apprentissage
   — au même titre que `source` et `entityType` — et de la clé d'unicité. `suggest()` et
   `learnFromCorrections()` acceptent `sourceVersion` en dernier paramètre, **optionnel** :
   si omis, le service applique `DEFAULT_SOURCE_VERSION` (`"default"`). Un connecteur qui
   n'a encore jamais changé de format n'a donc rien à fournir de plus qu'aujourd'hui ; un
   connecteur qui évolue déclare explicitement sa nouvelle version (ex. `"2026.1"`), sans
   toucher aux règles apprises sous l'ancienne.

## Alternatives envisagées

- **Mapping codé en dur par type d'import (dans `import-export` uniquement)** : écarté —
  aurait fonctionné pour le Jalon 2 mais aurait nécessité de tout reconstruire pour
  Magento/CRM/fournisseurs, contrairement à la demande explicite de réutilisabilité.
- **Bibliothèque tierce de correspondance floue / embeddings** : écartée — introduirait une
  dépendance et un comportement moins explicable, alors que l'exigence est un système
  "simple et explicable, pas une IA opaque".
- **Module métier `column-mapping` dans la liste de `docs/architecture.md` §3** : écarté au
  profit d'un dossier d'infrastructure partagée sous `common/`, car ce moteur ne porte
  aucune responsabilité métier propre — il est consommé par les modules métier, pas un
  domaine métier en soi.

## Conséquences

- `docs/architecture.md` (§3 et §4) et `docs/modele-donnees.md` (§9) sont mis à jour pour
  documenter ce moteur partagé et le modèle `ColumnMappingRule`.
- Tout futur connecteur (Magento, CRM, fournisseurs, clients, export...) devra définir sa
  propre configuration de mapping et l'enregistrer via `ColumnMappingModule`, sans jamais
  modifier le moteur générique lui-même.
- Les services métier d'import (E5+, à commencer par les articles OpenSi) devront
  transmettre les corrections de mapping utilisées jusqu'à l'étape de confirmation, pour
  que `ColumnMappingService.learnFromCorrections()` puisse les enregistrer à ce moment-là.
- Si un futur connecteur a besoin d'un vocabulaire de synonymes radicalement différent pour
  un même `entityType` (ex. "ARTICLES" chez Magento vs OpenSi), la portée
  `(source, sourceVersion, entityType)` de `ColumnMappingRule` l'isole déjà correctement —
  aucune adaptation du modèle ne sera nécessaire.
- Un futur écran d'historique/administration du mapping pourra afficher `sourceVersion`
  pour expliquer pourquoi une règle apprise ne s'applique plus après un changement de
  format côté source — mais aucun écran de ce type n'est prévu en V0.9.
