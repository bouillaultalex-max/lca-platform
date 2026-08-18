# Architecture — LCA-MES V0.9

## 1. Vue d'ensemble

LCA-MES V0.9 est un **monolithe modulaire** : une seule application backend (NestJS), une seule base de données (PostgreSQL), un seul frontend (React/Vite), déployés sur un poste du réseau local du laboratoire.

```
[ React (Vite + Tailwind) ]  ──HTTP/API──▶  [ NestJS (API + sert le build React) ]  ──Prisma──▶  [ PostgreSQL ]
            ▲
            └── accédé depuis les postes du réseau local du laboratoire (navigateur)
```

Le backend NestJS sert à la fois l'API REST et les fichiers statiques du build React : **un seul processus, un seul port**, pas de CORS à gérer en interne, déploiement minimal.

## 2. Principes directeurs

- **Simplicité avant tout** : pas de microservices, pas de message broker, pas de gateway edge, pas d'infrastructure distribuée. Le contexte (2 utilisateurs actifs, 1 site, développeur solo) ne justifie pas cette complexité.
- **Découpage par domaine métier**, pas par couche technique : chaque module Nest correspond à un domaine métier cohérent, avec ses propres controllers/services/DTO.
- **Prisma schema = source unique de vérité** du modèle de données. Toute évolution passe par une migration versionnée en git.
- **Aucune duplication de base de données.**
- **Développement local sans Docker.** Docker Compose est une option de déploiement ultérieure, jamais un prérequis pour développer.
- **Points d'extension documentés, non anticipés en code** : le modèle et les frontières de modules sont pensés pour accueillir le multi-site et la connexion machine plus tard, sans qu'aucun code de ces fonctionnalités n'existe en V0.9.

## 3. Découpage modulaire (modules NestJS)

| Module | Responsabilité |
|---|---|
| `auth` | Authentification, utilisateurs, rôles (`RESPONSABLE_LABORATOIRE`, `RESPONSABLE_ADJOINT`, `DIRECTION`, `DAF`) |
| `catalog` | Produits finis, recettes, matières premières, packaging |
| `stock` | Quantités disponibles par article, mouvements de stock |
| `batching` | Ordres de fabrication / batchs (recette, machine, format, quantités) |
| `production` | Saisie manuelle de l'état machine (temps, rebuts, arrêts, changements de format) |
| `traceability` | Généalogie des lots (lot fini ↔ matières premières/packaging consommés) |
| `quality` | Contrôle qualité simple rattaché à un lot |
| `costing` | Calcul et historisation du coût matière + packaging par flacon |
| `import-export` | Imports/exports Excel/CSV avec OpenSi (prévisualisation, journalisation) |
| `audit-log` | Journal technique des écritures sensibles (qui, quoi, quand) |
| `rnd` | Recherche & développement — tranche 1 (Aromathèque) : backend terminé, bibliothèque d'échantillons fournisseurs, import + consultation ; frontend de consultation/import implémenté (non commité, revu `pr-review-toolkit` avec verdict GO). Reste du module (recettes expérimentales, essais, validation, promotion) non conçu — voir `docs/roadmap.md` |
| `logistique` *(futur, post-V0.9)* | Expédition, conditionnement (cartons), exports transporteurs — voir `docs/roadmap.md` |

La logique métier vit exclusivement dans les services de chaque module. Les controllers restent fins (validation d'entrée, appel du service, sérialisation de sortie). L'accès aux données passe par Prisma, encapsulé dans les services (pas d'accès Prisma direct depuis les controllers).

### Infrastructure partagée (hors liste des modules métier)

En plus des modules métier ci-dessus, `src/common/` héberge des briques transverses sans
responsabilité métier propre, consommées par un ou plusieurs modules :

- `common/column-mapping/` — moteur générique de correspondance colonne → champ, utilisé
  aujourd'hui par `import-export` pour les imports OpenSi (voir ADR 0003). Conçu pour être
  réutilisé par tout futur connecteur (Magento, CRM, fournisseurs, clients...) sans jamais
  contenir lui-même de connaissance métier : il ne connaît qu'une source, une
  configuration de champs attendus (définie par le module consommateur) et les règles de
  correspondance apprises (mémorisées en base, réutilisées automatiquement lors des
  imports suivants).

## 4. Organisation des dossiers (cible, une fois le code créé)

```
lca-mes/
├── apps/
│   ├── api/                     # NestJS
│   │   ├── src/
│   │   │   ├── catalog/
│   │   │   ├── stock/
│   │   │   ├── batching/
│   │   │   ├── production/
│   │   │   ├── traceability/
│   │   │   ├── quality/
│   │   │   ├── costing/
│   │   │   ├── import-export/
│   │   │   ├── auth/
│   │   │   ├── audit-log/
│   │   │   └── common/
│   │   │       └── column-mapping/  # moteur générique de mapping (ADR 0003)
│   │   └── prisma/
│   │       ├── schema.prisma
│   │       └── migrations/
│   └── web/                     # React + Vite + Tailwind
│       └── src/
│           ├── pages/
│           ├── components/
│           └── api/             # client HTTP typé
├── packages/
│   └── shared/                  # DTO/enums/types partagés backend ↔ frontend
├── docs/
│   ├── architecture.md
│   ├── modele-donnees.md
│   ├── regles-metier.md
│   ├── roadmap.md
│   └── adr/
├── scripts/
│   └── backup.ps1               # sauvegarde automatique (pg_dump + rotation)
├── docker-compose.yml            # ajouté plus tard, pour le déploiement uniquement
└── README.md
```

## 5. Flux de données principaux

### Import OpenSi → Catalogue/Stock
Fichier Excel/CSV → parsing → **prévisualisation** (aucune écriture) → validation utilisateur → écriture en base (articles, stocks, besoins, inventaire) → entrée dans le journal d'import.

### Batch → Stock → Traçabilité → Coût
Création d'un batch (recette + machine + format + quantité prévue) → saisie manuelle en fin de production (quantité produite, rebuts, temps, arrêts) → génération du lot fini → déduction des stocks de matières premières/packaging consommés → enregistrement de la généalogie (`traceability`) → calcul et historisation du coût par flacon (`costing`), figé à la date de production.

### Export vers OpenSi
Productions terminées, consommations matières, mouvements de stock, inventaires et rapports → génération de fichiers Excel/CSV consultables/téléchargeables (fonctionnalité de fin de périmètre V0.9, voir `docs/roadmap.md`).

## 6. Sécurité et rôles

Deux niveaux d'accès :
- **Complet** (`RESPONSABLE_LABORATOIRE`, `RESPONSABLE_ADJOINT`) : création, modification, suppression sur l'ensemble des modules.
- **Lecture seule** (`DIRECTION`, `DAF`) : accès aux rapports, statistiques, coûts, stocks et tableaux de bord uniquement — aucun accès aux écrans de saisie/édition.

Le contrôle d'accès est implémenté via des guards NestJS appliqués au niveau des controllers, avec une vérification systématique du rôle avant toute opération d'écriture.

## 7. Déploiement

- **Développement local** : npm + PostgreSQL installé localement + Prisma. Aucun Docker requis.
- **Production (poste du laboratoire)** : Docker Compose (containers `api` et `postgres`) proposé comme option de déploiement, à ajouter dans une itération ultérieure — cette option ne doit jamais complexifier le flux de développement local.
- Accès réseau : les 2 postes du laboratoire (et les postes direction/DAF en consultation) accèdent à l'application via le réseau local (navigateur, IP ou nom d'hôte interne du poste serveur).
- Sauvegardes automatiques : `pg_dump` planifié avec rotation, procédure de restauration documentée et testée avant mise en production réelle.

## 8. Points d'extension pour les évolutions futures

Ces points sont **prévus dans la conception du modèle et des frontières de modules**, mais ne doivent pas être codés en V0.9 :

- **Multi-site** : une colonne `siteId` existe dès la V0.9 sur les entités concernées (batch, lot, mouvement de stock…), avec un site unique créé par défaut.
- **Connexion machine** : le module `production` sépare déjà la « saisie de l'état machine » (aujourd'hui : formulaire manuel) du « traitement métier de cet état » (déduction de stock, généalogie, coût). Une future connexion machine (OPC-UA/Modbus/MQTT) viendrait remplacer uniquement la source de saisie, sans toucher au traitement métier.
- **Module `logistique`** (post-V0.9) : expédition, conditionnement en cartons, exports transporteurs. La règle de conditionnement (flacons 10/30/50/100 ml → cartons de 100 ; 200 ml → cartons de 36, actée le 2026-07-06, voir `docs/roadmap.md`) sera modélisée dès le Jalon 2 (module `stock`) pour être réutilisable par ce futur module sans refonte.
- **Module `r&d`** : tranche 1 (Aromathèque — bibliothèque d'échantillons fournisseurs, import + consultation) intégrée au périmètre V0.9 (décision du 2026-08-11, voir `PROJECT_STATE.md` §6) — backend terminé, frontend de consultation/import implémenté (non commité, revu `pr-review-toolkit` avec verdict GO, voir `PROJECT_STATE.md` §6) ; le reste (recettes expérimentales, essais, validation/rejet, promotion vers le catalogue de production) demeure un point d'extension post-V0.9, non conçu — voir `docs/roadmap.md`.
