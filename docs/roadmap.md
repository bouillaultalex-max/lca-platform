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

## Jalon 2 — Catalogue & cœur production

- Module `catalog` : produits, recettes, matières premières, packaging
- Module `import-export` : import OpenSi (articles, références, stocks, besoins attendus, inventaire) avec prévisualisation
- Module `stock` : état des stocks, mouvements
- Module `batching` : création et suivi de batch
- Module `production` : saisie manuelle de fin de batch (quantités, rebuts, temps, arrêts, changement de format)
- Génération des lots (`Lot`) et déduction automatique des stocks associés (rebuts inclus, voir `docs/regles-metier.md` §3)

**Livrable** : catalogue alimentable manuellement ou par import OpenSi, un batch complet peut être créé, produit (saisie manuelle) et clôturé en générant un lot, avec impact automatique sur le stock.

## Jalon 3 — Traçabilité, qualité, coûts

- Module `traceability` : généalogie du lot (matières premières + packaging consommés)
- Module `quality` : contrôle qualité simple par lot
- Module `costing` : calcul et historisation du coût matière + packaging par flacon

**Livrable** : chaque lot est intégralement traçable (généalogie), contrôlé qualité, et son coût par flacon est calculé et figé.

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

## Suivi

Ce document doit être mis à jour à la fin de chaque jalon (statut réel vs prévu, écarts, décisions de re-priorisation) plutôt que réécrit rétroactivement en fin de projet.
