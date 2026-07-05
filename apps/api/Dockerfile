# Dockerfile — image de production de LCA-MES.
# Construit à partir de la racine du monorepo : docker build -f apps/api/Dockerfile .
#
# Un seul déployable : cette image sert à la fois l'API NestJS et les fichiers
# statiques du build React (apps/web), conformément à docs/architecture.md.
# N'est utilisée que pour le déploiement — le développement local n'a pas besoin
# de Docker (voir README.md).

# ---- Étape 1 : build du frontend (apps/web) ----
FROM node:20-alpine AS web-build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
RUN npm ci
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build --workspace apps/web

# ---- Étape 2 : build du backend (apps/api) ----
FROM node:20-alpine AS api-build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY apps/api apps/api
RUN npm run prisma:generate --workspace apps/api
RUN npm run build --workspace apps/api

# ---- Étape 3 : image d'exécution ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -S lcames && adduser -S lcames -G lcames

COPY --from=api-build /repo/apps/api/package.json ./package.json
COPY --from=api-build /repo/apps/api/dist ./dist
COPY --from=api-build /repo/apps/api/prisma ./prisma
COPY --from=api-build /repo/apps/api/prisma.config.ts ./prisma.config.ts

# Dépendances de production uniquement (pas de devDependencies dans l'image finale).
# Ne pas passer --ignore-scripts : le postinstall de `prisma`/`@prisma/engines`
# télécharge le binaire "schema-engine" nécessaire à `prisma migrate deploy` au
# démarrage du conteneur. Le client Prisma lui-même est déjà compilé dans ./dist
# (copié depuis l'étape api-build) : inutile de relancer `prisma generate` ici.
#
# Simplification assumée pour la V0.9 : cet install repart des plages semver du
# package.json plutôt que du lockfile exact du monorepo (impossible à réutiliser
# tel quel une fois apps/api isolé de la structure de workspaces). Le risque de
# dérive de version est faible (même registre, même fenêtre de build), mais si
# une reproductibilité stricte devient nécessaire, préférer copier node_modules
# déjà installé par `api-build` (via npm ci) puis le pruner avec `npm prune --omit=dev`.
RUN npm install --omit=dev && npm cache clean --force

# Build React servi statiquement par Nest (voir ServeStaticModule dans app.module.ts)
COPY --from=web-build /repo/apps/web/dist ./dist/public

RUN chown -R lcames:lcames /app
USER lcames

EXPOSE 3000

# Applique les migrations puis démarre l'API. `prisma migrate deploy` (contrairement
# à `migrate dev`) ne génère jamais de nouvelle migration : il ne fait qu'appliquer
# celles déjà commitées, ce qui est le comportement sûr attendu en production.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main.js"]
