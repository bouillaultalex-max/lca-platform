# MASTER SPECIFICATION — LCA-MES V0.9

Document de référence consolidant le périmètre fonctionnel, les contraintes et les décisions validées pour la version V0.9 de LCA-MES. Toute évolution de ce périmètre doit être répercutée dans ce document.

## 1. Présentation

LCA-MES est le logiciel de gestion de production du laboratoire de **LCA Distribution** (marque **Maison Fuel**). Il couvre le catalogue produits, les recettes, les matières premières, le packaging, les stocks, le batching, la production, la traçabilité des lots, le contrôle qualité simple et le calcul de coût par flacon.

## 2. Contexte métier

- **Activité** : conditionnement de produits (parfums d'ambiance / recharges "Maison Fuel") en flacons de différents formats, à partir de matières premières stockées en fûts et seaux.
- **Formats de conditionnement** : 10 ml, 30 ml, 50 ml, 100 ml, 200 ml.
- **Stock matières premières (ordre de grandeur actuel)** : ~8 fûts de 200 L, ~15 seaux de 30 L.
- **Recettes** : ~100 recettes actives.
- **Machines de conditionnement** :
  - 1 CDA E-Fill en service (formats 50/100/200 ml)
  - 1 seconde CDA E-Fill prévue sous ~3 mois
  - 1 machine chinoise automatique dédiée au format 30 ml (concentrés), prévue sous ~3 mois
  - Aucune connexion directe machine ↔ logiciel en V0.9 : toutes les données de production sont saisies manuellement (voir §4.4).
- **ERP existant** : OpenSi (utilisé par LCA Distribution). Pas d'intégration directe technique en V0.9 — échanges par fichiers Excel/CSV (voir §4.3 et §4.8).
- **Production couverte en V0.9** : Maison Fuel uniquement.
- **Marchés** : un batch peut être destiné à un ou plusieurs marchés (destination commerciale ou réglementaire, ex. France, Suisse) — notion indépendante du site de production (mono-site en V0.9, voir §6).

## 3. Utilisateurs et rôles

| Rôle | Accès |
|---|---|
| `RESPONSABLE_LABORATOIRE` | Complet (création / modification / suppression sur tous les modules) |
| `RESPONSABLE_ADJOINT` | Complet (identique au responsable laboratoire) |
| `DIRECTION` | Lecture seule : rapports, statistiques, coûts, stocks, tableaux de bord |
| `DAF` | Lecture seule : rapports, statistiques, coûts, stocks, tableaux de bord |

Échelle V0.9 : 2 utilisateurs à accès complet, accès consultation ouvert à la direction/DAF, 1 seul site de production.

## 4. Périmètre fonctionnel V0.9

### 4.1 Catalogue
Gestion des produits finis, des recettes (composition en matières premières et packaging par format), des matières premières et du packaging. Chaque article référence son code OpenSi, son unité de mesure et son coût unitaire courant.

### 4.2 Stocks
Suivi des quantités disponibles par article (matière première, packaging, produit fini) et de tous les mouvements de stock, horodatés et rattachés à un utilisateur.

### 4.3 Imports OpenSi
Import de fichiers Excel/CSV en provenance d'OpenSi :
- articles
- références
- stocks
- besoins attendus
- inventaire

Chaque import passe par une **prévisualisation obligatoire** avant validation, et est journalisé (fichier, date, utilisateur, nombre de lignes, erreurs).

### 4.4 Batching & production
Création d'un batch : recette, machine, format, quantité prévue. Saisie manuelle en fin de batch :
- machine utilisée
- format
- quantité prévue
- quantité produite
- rebuts
- heure de début / heure de fin
- changement de format éventuel
- arrêts (motif + durée)

### 4.4bis Allocation multi-produits
Un batch représente un run physique unique autour d'un seul mélange commun ; il peut produire plusieurs sorties commerciales (allocations), par exemple pour plusieurs marchés (destination commerciale ou réglementaire, ex. France, Suisse) :
- tout batch possède au moins une allocation, y compris un batch standard sur un produit sans déclinaison commerciale (pas un cas particulier) ;
- une seule allocation par produit fini, et une seule par marché quand un marché est renseigné, dans un même batch ;
- chaque allocation génère exactement un lot fini ;
- le mélange et la recette (matières premières) restent communs à tout le batch, calculés une seule fois ;
- le packaging est **dérivé automatiquement** de la recette du produit fini de chaque allocation — jamais saisi librement ;
- quand un produit appartient à une famille commerciale, le produit et la recette de chaque marché sont résolus automatiquement par le catalogue — l'utilisateur choisit un marché, jamais une recette ni, dans ce cas, un produit ;
- la répartition entre allocations est définie avant l'étape de conditionnement ;
- les rebuts sont suivis par allocation ;
- les consommations de packaging sont calculées sur la quantité conforme + rebuts de chaque allocation.

Hors périmètre : commandes, expéditions et règles réglementaires détaillées par marché (voir §5). Voir ADR 0006 et `docs/features/PRD-11-allocation-multi-marches/` pour le détail des décisions et de l'architecture retenue.

### 4.5 Lots & traçabilité
Génération d'un lot produit fini par allocation (un batch standard à une seule allocation produit un seul lot ; un batch réparti sur plusieurs sorties commerciales produit un lot par allocation, voir §4.4bis). Enregistrement de la **généalogie** : lien entre chaque lot fini et les lots/quantités de matières premières et de packaging consommés — condition nécessaire pour permettre un rappel produit ciblé.

### 4.6 Contrôle qualité
Contrôle qualité simple rattaché à un lot : résultat (conforme / non conforme), commentaire, utilisateur, date.

### 4.7 Coûts
Calcul du coût matière première + packaging par flacon, à partir des coûts unitaires courants des articles et de la composition de la recette utilisée. Le coût est **figé (historisé)** au moment de la production, pour ne pas être affecté par une évolution ultérieure des coûts unitaires.

Pour un batch réparti entre plusieurs marchés (§4.4bis), le coût du mélange est réparti proportionnellement entre les allocations au prorata de leur quantité traitée (`producedQuantity + rejectedQuantity`, rebuts inclus — voir ADR 0006 décision 20), tandis que le coût du packaging est calculé directement par allocation (packaging propre à chaque marché).

### 4.8 Exports vers OpenSi
Export de fichiers Excel/CSV à destination d'OpenSi :
- productions terminées
- consommations matières
- mouvements de stock
- inventaires
- rapports

## 5. Hors périmètre V0.9 (évolutions futures anticipées, non codées)

- Connexion machine directe (OPC-UA, Modbus, MQTT), gateway edge, IoT
- Multi-site complet (l'architecture prévoit un identifiant de site, mais un seul site est utilisé en V0.9)
- Application mobile
- IA avancée, optimisation de planning — **à l'exception du chantier assistant (tickets AI-01 à AI-08, tous terminés et validés, voir `docs/roadmap.md`)** : infrastructure de conversation IA, 6 outils métier réels strictement en lecture seule, et un fournisseur OpenAI optionnel (`AI_PROVIDER=openai`, `EchoAiProvider` restant le fournisseur par défaut et le repli local) — aucune action métier en écriture, aucune optimisation de planning
- Commandes, expéditions et règles réglementaires détaillées par marché (l'allocation multi-marchés couvre uniquement la répartition de production et de packaging — voir §4.4bis)

## 6. Contraintes techniques

- Fonctionnement **on-premise**, accès depuis 2 postes du réseau local du laboratoire (+ consultation direction/DAF)
- Base **PostgreSQL unique**, aucune duplication de base
- **Développement local sans Docker** : npm + PostgreSQL local + Prisma + NestJS + React/Vite. Docker Compose optionnel, réservé au déploiement
- Traçabilité forte, sauvegardes automatiques, code maintenable, documentation obligatoire
- Stack validée : monolithe modulaire NestJS + React/Vite/TypeScript + PostgreSQL + Prisma + Tailwind CSS

## 7. Échéance

Livraison du MVP V0.9 visée : **fin août 2026**. Voir `docs/roadmap.md` pour le phasage détaillé.

## 8. Documents associés

- `docs/architecture.md` — architecture technique détaillée
- `docs/modele-donnees.md` — modèle de données
- `docs/regles-metier.md` — règles métier détaillées
- `docs/roadmap.md` — feuille de route
- `docs/adr/0001-architecture-v09.md` — décision d'architecture V0.9
- `docs/adr/0006-allocation-marche-batch.md` — allocation multi-marchés (PRD-11)
- `docs/features/PRD-11-allocation-multi-marches/` — spécification PO, revue d'architecture et décisions métier de la feature
