# Roadmap — LCA-MES V0.9

Objectif : livrer un MVP resserré mais propre couvrant l'ensemble du cœur métier (catalogue, recettes, matières premières, packaging, stocks, imports OpenSi, batching, production, lots, traçabilité, contrôle qualité simple, coût par flacon) d'ici **fin août 2026**.

> Le calendrier est serré pour un développeur solo assisté par IA sur ce périmètre. Les jalons ci-dessous sont indicatifs et à ajuster ensemble au fil de l'avancement — l'important est de garder une visibilité continue sur l'écart entre avancement réel et échéance, pas de suivre ce planning au jour près.

## Jalon 0 — Cadrage (terminé)

- Architecture validée
- Documentation de référence créée (ce dépôt)

## Jalon 1 — Socle technique (terminé le 2026-07-05)

- Scaffolding NestJS (backend) + React/Vite/Tailwind (frontend), sans Docker requis en développement
- Configuration Prisma 7 + PostgreSQL (driver adapter), première migration (`Site`, `User`, `AuditLog`)
- Module `auth` : utilisateurs, 4 rôles, JWT, guards globaux, contrôle d'accès complet / lecture seule
- Swagger, validation d'environnement, `/health`, `ServeStaticModule`
- Option de déploiement Docker Compose (non testée avec un Docker réel, voir `PROJECT_STATE.md`)

**Livrable réalisé** : application démarrable en local (`npm install` + `npm run dev:api`/`dev:web`), authentification fonctionnelle de bout en bout (vérifiée en navigateur), tests unitaires/e2e verts. Périmètre resserré par rapport à la version initiale de ce document : `catalog` et `import-export` ont été déplacés au Jalon 2 (prérequis fonctionnels de `stock`/`batching`, pas du socle technique).

## Jalon 2 — Catalogue & cœur production ✅ Terminé le 2026-07-07

- ✅ Module `catalog` : produits, recettes, matières premières, packaging (terminé le 2026-07-06 — backend + frontend, vérifié en navigateur)
- ✅ Module `stock` : état des stocks, mouvements, FIFO, ajustement d'inventaire (terminé le 2026-07-06 — backend + frontend, vérifié en navigateur)
- ✅ Module `batching` : création et suivi de batch, avec **calcul automatique des quantités de chaque ingrédient/packaging** (volume + masse) à partir de la recette et de la quantité à produire (terminé le 2026-07-06 — remplace le calcul jusque-là fait dans un fichier Excel, voir `docs/regles-metier.md` §12)
- ✅ Module `production` : saisie manuelle des 4 étapes réelles — préparation, mélange, incorporation en trémie, conditionnement machine — gestion des arrêts, clôture avec génération du lot (terminé le 2026-07-06 — backend + frontend, vérifié en navigateur). **Aucune étape de maturation**, conforme à la décision actée.
- ✅ Génération des lots (`Lot`) et déduction automatique des stocks associés (rebuts inclus, voir `docs/regles-metier.md` §3) — réalisée à la clôture du batch, en une transaction Prisma atomique
- ✅ Module `import-export` **(backend)** : moteur générique de mapping de colonnes versionné (voir ADR 0003, réutilisable par de futurs connecteurs) + 4 imports OpenSi — articles (upsert, type immuable), stocks (réutilise `StockLotsService.receive()`, atomicité totale), besoins attendus (historique append-only), inventaire (volontairement partiel, en attente d'un fichier réel OpenSi) — terminé le 2026-07-06
- ✅ Écran frontend Imports : assistant en 5 étapes (type, fichier, colonnes, aperçu, confirmation), vocabulaire sans jargon technique, tableau de bord visuel, écran de réussite, historique filtrable — terminé le 2026-07-07, vérifié en navigateur (build/lint/tests verts, 218 tests unitaires + 35 e2e)

**Livrable** : catalogue alimentable manuellement ou par import OpenSi, un batch complet peut être créé, produit (saisie manuelle) et clôturé en générant un lot, avec impact automatique sur le stock. **Jalon 2 entièrement livré.**

## Jalon 2.5 — Gestion des utilisateurs ✅ Terminé le 2026-07-07

- ✅ Modèle de données : `JobTitle` (fonction métier, entité dédiée plutôt que texte libre), `User` étendu (`jobTitleId`, `isSystemAdmin` indépendant du rôle logiciel, `mustChangePassword`, `lastLoginAt`), `LoginHistory` (nouvelle table, distincte d'`AuditLog`, historique des tentatives de connexion réussies/échouées)
- ✅ `AuditLog` branché pour la première fois (jusque-là défini mais inutilisé), limité aux actions de gestion des comptes
- ✅ Écran Administration > Utilisateurs : création (mot de passe temporaire généré, affiché une seule fois), modification, désactivation (bloque immédiatement la connexion), réinitialisation de mot de passe, gestion des fonctions métier
- ✅ Changement de mot de passe obligatoire à la première connexion (`MustChangePasswordGuard`, appliqué par défaut à toute route authentifiée) + page dédiée
- ✅ Script d'amorçage du premier administrateur système (`npm run prisma:bootstrap-admin`, séparé de `seed.ts`)
- ✅ 3 comptes réels créés et vérifiés en navigateur : Alexandre Bouillault (Responsable adjoint + administrateur système), Kevin Prian (Responsable laboratoire), Jean-Paul Gouveia (Direction)
- ✅ Message d'accueil personnalisé sur le tableau de bord ("Bonjour {prénom} 👋", dernière connexion en langage naturel — Aujourd'hui/Hier/date complète, jamais de date brute), à partir de `lastLoginAt` déjà présent sur `User`, sans nouvelle table

**Livrable** : premiers comptes nominatifs réels opérationnels, avec permissions d'administration séparées des rôles métier, conformes aux règles de sécurité validées (mots de passe jamais en clair, compte désactivé = connexion refusée, changement de mot de passe obligatoire à la première connexion). Build/lint/tests verts (238 tests unitaires + 38 e2e), vérifié en navigateur.

## Jalon 3 — Traçabilité, qualité, coûts

- Module `traceability` : généalogie du lot (matières premières + packaging consommés)
- Module `quality` : contrôle qualité simple par lot
- Module `costing` : calcul et historisation du coût matière + packaging par flacon

**Livrable** : chaque lot est intégralement traçable (généalogie), contrôlé qualité, et son coût par flacon est calculé et figé.

## Décisions actées le 2026-07-06

- **Conditionnement en cartons** : les flacons sont conditionnés par carton selon leur format :
  - 10 ml, 30 ml, 50 ml, 100 ml → cartons de 100 flacons
  - 200 ml → cartons de 36 flacons

  Cette règle doit être exploitée par les modules `stock` et `production` (Jalon 2), ainsi que par un futur module `logistique` (voir "Évolutions futures" ci-dessous). La modélisation exacte (champ sur `Article`, table de correspondance...) sera proposée et validée au démarrage de la Phase C (module `stock`), avant tout code.
- **Nouveau module futur : R&D**, anticipé pour une version ultérieure à la V0.9 (voir "Évolutions futures" ci-dessous).
- **Workflow réel de préparation/batching/production** validé avec le responsable laboratoire (voir `docs/regles-metier.md` §12) : consultation des besoins → adaptation des quantités par gamme (couverture visée d'environ 1 mois ou plus) → préparation de la recette selon la quantité à produire → batching → mélange → incorporation en trémie → conditionnement machine. Aucune maturation. Impacte directement la conception des modules `batching`/`production` (Phase D).
- **Calcul volume + masse en préparation de batch** : les recettes restent exprimées en % de volume ; une densité optionnelle par matière première (`Article.densityKgPerL`) permet d'afficher la masse à peser, sans valeur par défaut codée en dur — "densité manquante" affiché explicitement si absente. La déduction de stock, elle, reste en volume (L).
- **Étape de production distincte du statut** : `BatchStep` (`PREPARATION`/`MELANGE`/`INCORPORATION_TREMIE`/`CONDITIONNEMENT`) est un champ séparé de `BatchStatus`, avec progression stricte et sans retour en arrière.
- **Point noté pour un futur module `traceability`** (Jalon 3) : le numéro de lot généré à la clôture d'un batch n'est aujourd'hui affiché qu'immédiatement après la clôture — il n'est pas encore consultable en rechargeant un batch terminé (pas d'endpoint de lecture des lots).

## Jalon 4 — Sortie, fiabilisation, documentation finale

- Exports vers OpenSi (productions terminées, consommations matières, mouvements de stock, inventaires, rapports)
- Tableaux de bord et rapports pour les rôles `DIRECTION`/`DAF` (lecture seule)
- Sauvegardes automatiques (`pg_dump` planifié) + test de restauration
- Tests sur la logique à risque (coût, déduction de stock, généalogie)
- Documentation finale à jour (README, guides d'utilisation de base)

**Livrable** : V0.9 complète, sauvegardée automatiquement, documentée, prête pour une utilisation réelle au laboratoire.

## Hors périmètre V0.9 (rappel)

Ces éléments ne font partie d'aucun jalon ci-dessus et ne doivent pas être anticipés :
- Connexion machine (OPC-UA, Modbus, MQTT), gateway edge, IoT
- Multi-site complet
- Application mobile
- IA avancée, optimisation de planning

## Évolutions futures (post-V0.9, actées le 2026-07-06 mais non planifiées en détail)

Contrairement à la section précédente, ces évolutions sont **prévues pour une version ultérieure** — elles ne sont pas codées en V0.9, mais leur existence future doit être gardée à l'esprit dans les choix de modélisation (sans les anticiper en code).

- **Module `logistique`** : expédition, conditionnement (cartons), exports transporteurs. Périmètre exact non détaillé — utilisera la règle de conditionnement en cartons actée ci-dessus.
- **Module `r&d`** (recherche & développement) :
  - création de recettes expérimentales, distinctes des recettes de production actives ;
  - réalisation d'essais ;
  - validation ou rejet d'une recette expérimentale ;
  - promotion d'une recette validée vers le catalogue de production (module `catalog`).

## Suivi

Ce document doit être mis à jour à la fin de chaque jalon (statut réel vs prévu, écarts, décisions de re-priorisation) plutôt que réécrit rétroactivement en fin de projet.
