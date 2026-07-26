# LCA-MES

Logiciel de gestion de production pour le laboratoire de **LCA Distribution** (marque **Maison Fuel**) : catalogue produits/recettes, matières premières, packaging, stocks, batching, production, traçabilité des lots, contrôle qualité et coût par flacon.

## État du projet

**L'état réel et à jour du dépôt est documenté dans [`PROJECT_STATE.md`](./PROJECT_STATE.md)**, mis à jour à la fin de chaque jalon/chantier — ce `README.md` ne duplique volontairement pas ce contenu en détail pour ne pas risquer de devenir obsolète (voir ticket DOC-01, 2026-07-26). Se référer à `PROJECT_STATE.md` §1 pour le tableau des jalons et leur statut réel.

## Stack technique

- **Backend** : NestJS + TypeScript (`apps/api`)
- **Frontend** : React + Vite + TypeScript + Tailwind CSS (`apps/web`)
- **Base de données** : PostgreSQL (instance unique) + Prisma 7 (driver adapter `@prisma/adapter-pg`)
- **Types partagés** : `packages/shared`

## Démarrage en développement local (sans Docker)

Prérequis : Node.js 20+, npm 10+, PostgreSQL installé et démarré localement.

```bash
# 1. Créer le rôle et la base de développement (une seule fois, via psql)
psql -U postgres -c "CREATE ROLE lca_mes LOGIN PASSWORD 'changez-moi';"
psql -U postgres -c "CREATE DATABASE lca_mes_dev OWNER lca_mes;"

# 2. Installer les dépendances (racine du monorepo)
npm install

# 3. Configurer l'API
cp apps/api/.env.example apps/api/.env   # ajuster DATABASE_URL / JWT_SECRET
npm run prisma:migrate                    # applique les migrations sur lca_mes_dev
npm run prisma:seed                       # crée le site + l'utilisateur par défaut

# 4. Démarrer les deux applications (deux terminaux)
npm run dev:api    # NestJS sur http://localhost:3000 (Swagger: /api/docs)
npm run dev:web    # React/Vite sur http://localhost:5173 (proxy /auth, /health vers l'API)
```

Utilisateur créé par le seed (développement uniquement — à changer avant tout usage réel) :
`responsable@lca-mes.local` / `ChangezMoi123!`

**Docker n'est jamais requis pour développer.** Le frontend (Vite) proxy ses appels `/auth`, `/health` (et plus tard `/api`) vers l'API sur `localhost:3000` — aucune configuration CORS à gérer.

## Tests

```bash
npm run test:api        # tests unitaires (apps/api)
npm run test:api:e2e    # tests e2e (nécessite une base dédiée, voir ci-dessous)
```

Les tests e2e utilisent une base **distincte** de la base de développement. Une seule fois :

```bash
psql -U postgres -c "CREATE DATABASE lca_mes_test OWNER lca_mes;"
cp apps/api/.env.test.example apps/api/.env.test   # ajuster si besoin
cd apps/api && DATABASE_URL="postgresql://lca_mes:<mdp>@localhost:5432/lca_mes_test?schema=public" npx prisma migrate deploy
```

## Déploiement (option Docker Compose)

Réservé au déploiement (poste du laboratoire) — jamais nécessaire en développement.

```bash
cp .env.example .env   # POSTGRES_PASSWORD, JWT_SECRET à renseigner
docker compose up -d --build
```

Démarre PostgreSQL et l'API (qui sert aussi le build React compilé) sur `http://localhost:3000`. Les migrations Prisma (`prisma migrate deploy`) s'appliquent automatiquement au démarrage du conteneur `api`.

> Les artefacts Docker (`Dockerfile`, `docker-compose.yml`) ont été rédigés et raisonnés avec soin mais **n'ont pas pu être testés dans cet environnement de développement** (Docker non installé ici). À valider avant un premier déploiement réel — voir le bilan de jalon pour le détail.

## Structure du monorepo

```
apps/
├── api/     # NestJS — voir apps/api/README.md
└── web/     # React + Vite + Tailwind
packages/
└── shared/  # Types TypeScript partagés (rôles, DTO d'auth)
docker-compose.yml, apps/api/Dockerfile   # déploiement (optionnel)
```

## Documentation

- [`MASTER_SPECIFICATION.md`](./MASTER_SPECIFICATION.md) — spécification fonctionnelle et technique de référence
- [`PROJECT_STATE.md`](./PROJECT_STATE.md) — état réel et à jour du dépôt (source de vérité de l'avancement)
- [`MASTER_BACKLOG.md`](./MASTER_BACKLOG.md) — backlog consolidé (features, dette technique, priorisation)
- [`docs/architecture.md`](./docs/architecture.md) — architecture détaillée, découpage modulaire, organisation des dossiers
- [`docs/modele-donnees.md`](./docs/modele-donnees.md) — modèle de données (entités, relations)
- [`docs/regles-metier.md`](./docs/regles-metier.md) — règles métier
- [`docs/roadmap.md`](./docs/roadmap.md) — feuille de route de la V0.9
- [`docs/adr/`](./docs/adr/) — décisions d'architecture (Architecture Decision Records)

## Périmètre V0.9 (résumé)

**Inclus** : catalogue, recettes, matières premières, packaging, stocks, imports OpenSi (Excel/CSV), batching, production (saisie manuelle), lots, traçabilité, contrôle qualité simple, coût matière + packaging par flacon.

**Hors périmètre** (évolutions futures) : connexion machine (OPC-UA/Modbus/MQTT), gateway edge, IoT, multi-site complet, application mobile, IA avancée, optimisation de planning — à l'exception du chantier assistant (AI-01 à AI-08 : infrastructure, 6 outils métier en lecture seule, fournisseur OpenAI optionnel, aucune action en écriture — voir `docs/roadmap.md` et `PROJECT_STATE.md`).

## Utilisateurs et rôles

| Rôle | Accès |
|---|---|
| `RESPONSABLE_LABORATOIRE` | Complet |
| `RESPONSABLE_ADJOINT` | Complet |
| `DIRECTION` | Lecture seule (rapports, statistiques, coûts, stocks, tableaux de bord) |
| `DAF` | Lecture seule (rapports, statistiques, coûts, stocks, tableaux de bord) |
