# LCA-MES — API

Backend NestJS de LCA-MES. Voir la documentation de référence à la racine du dépôt (`../../docs/architecture.md`, `../../docs/modele-donnees.md`) pour le contexte complet.

## Démarrage (développement local)

Prérequis : Node.js 20+, PostgreSQL installé et démarré localement.

```bash
# depuis la racine du monorepo
npm install
cp apps/api/.env.example apps/api/.env   # ajuster DATABASE_URL / JWT_SECRET si besoin
npm run prisma:migrate
npm run prisma:seed
npm run dev:api
```

L'API démarre par défaut sur `http://localhost:3000`. Documentation Swagger sur `http://localhost:3000/api/docs`.

## Structure

```
src/
├── auth/        # authentification JWT, rôles, guards
├── audit-log/   # journal technique des écritures sensibles
├── config/      # validation et typage des variables d'environnement
├── prisma/      # PrismaService / PrismaModule
└── common/      # décorateurs, filtres, éléments transverses
```

Les modules métier (catalog, stock, batching, production, traceability, quality, costing, import-export) seront ajoutés lors des jalons suivants (voir `../../docs/roadmap.md`).

## Scripts utiles

| Commande (depuis la racine) | Effet |
|---|---|
| `npm run dev:api` | démarre l'API en mode watch |
| `npm run build:api` | build de production |
| `npm run test:api` | tests unitaires |
| `npm run test:api:e2e` | tests end-to-end |
| `npm run prisma:generate` | régénère le client Prisma |
| `npm run prisma:migrate` | applique les migrations en développement |
| `npm run prisma:seed` | crée les données de départ (utilisateur admin par défaut) |
