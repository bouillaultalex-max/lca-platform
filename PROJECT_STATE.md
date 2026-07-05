# PROJECT_STATE — État du projet LCA-MES

Document de suivi vivant, à mettre à jour à la fin de chaque jalon. Contrairement aux autres documents de `docs/` (qui décrivent l'architecture cible), celui-ci décrit **l'état réel du dépôt aujourd'hui**.

Dernière mise à jour : **2026-07-05** — fin du Jalon 1 (socle technique), décisions métier du Jalon 2 actées.

## 1. Statut

| Jalon | Statut |
|---|---|
| Jalon 0 — Cadrage & documentation | ✅ Terminé |
| Jalon 1 — Socle technique | ✅ Terminé et vérifié (tests, build, navigateur) |
| Jalon 2 — Cœur production (catalogue, stock, batching, production, lots) | ⏳ À démarrer (plan à valider) |
| Jalon 3 — Traçabilité, qualité, coûts | Non démarré |
| Jalon 4 — Exports, tableaux de bord, sauvegardes | Non démarré |

Aucun module métier (catalogue, recette, stock, batching, production, traçabilité, qualité, coûts, import/export) n'est encore codé. Seul le socle technique existe.

## 2. Ce qui existe dans le dépôt

```
lca-mes/
├── apps/
│   ├── api/            # NestJS — auth (JWT+rôles), Prisma, Swagger, ServeStatic
│   └── web/             # React + Vite + Tailwind — login/dashboard fonctionnels
├── packages/
│   └── shared/          # Types partagés (UserRole, DTO auth)
├── docs/                 # architecture, modèle de données, règles métier, roadmap, ADR
├── docker-compose.yml, apps/api/Dockerfile   # déploiement (optionnel, non testé avec Docker réel)
├── CLAUDE.md, MASTER_SPECIFICATION.md, README.md
└── PROJECT_STATE.md       # ce fichier
```

Modules Nest existants : `auth`, `prisma`, `config`. Modèle Prisma existant : `Site`, `User`, `AuditLog` uniquement (le reste — `Article`, `Recipe`, `Batch`, `Lot`, `StockMovement`... — est documenté dans `docs/modele-donnees.md` mais pas encore dans `schema.prisma`).

## 3. Commandes utiles

### Développement local (sans Docker)
```bash
npm install                          # à la racine, une fois
npm run dev:api                      # API sur http://localhost:3000 (Swagger: /api/docs)
npm run dev:web                      # Frontend sur http://localhost:5173
```

### Base de données
```bash
npm run prisma:migrate               # applique les migrations sur lca_mes_dev
npm run prisma:seed                  # (re)crée le site + l'utilisateur par défaut
```

### Tests
```bash
npm run test:api                     # unitaires (apps/api)
npm run test:api:e2e                 # e2e — nécessite la base lca_mes_test + apps/api/.env.test
```

### Build / lint
```bash
npm run build:api
npm run build:web
npm run lint:api                     # eslint
cd apps/web && npm run lint          # oxlint
```

### Déploiement (optionnel)
```bash
cp .env.example .env                 # POSTGRES_PASSWORD, JWT_SECRET
docker compose up -d --build
```

## 4. Bases de données locales

| Base | Rôle | Usage |
|---|---|---|
| `lca_mes_dev` | `lca_mes` | Développement local (`apps/api/.env`) |
| `lca_mes_test` | `lca_mes` | Tests e2e uniquement (`apps/api/.env.test`) |

## 5. Comptes de test

| Email | Mot de passe | Rôle | Contexte |
|---|---|---|---|
| `responsable@lca-mes.local` | `ChangezMoi123!` | `RESPONSABLE_LABORATOIRE` | Créé par `npm run prisma:seed` (base `lca_mes_dev`) — **développement uniquement, à changer avant tout usage réel.** |

## 6. Décisions techniques prises (Jalon 1)

- Monolithe modulaire NestJS + React/Vite/Tailwind + PostgreSQL + Prisma, sans Docker requis en développement (voir `docs/adr/0001-architecture-v09.md`).
- Prisma 7 nécessite des ajustements non standards (générateur `moduleFormat = "cjs"`, driver adapter `@prisma/adapter-pg`, `tsx` pour le seed, `NODE_OPTIONS=--experimental-vm-modules` pour Jest) — détaillés dans `docs/adr/0002-prisma7-driver-adapter-pg.md`. **Important pour la suite** : toute nouvelle table Prisma doit passer par `npm run prisma:migrate`, jamais par une modification manuelle du schéma en base.
- Guards d'authentification globaux (`JwtAuthGuard` + `RolesGuard`) : tout nouvel endpoint est **protégé par défaut**. Utiliser `@Public()` pour un endpoint public, `@Roles(...)` pour restreindre par rôle.
- `ServeStaticModule` déjà configuré pour servir le build React en production (dossier `apps/api/public`, vide en développement).

## 7. Décisions métier confirmées

Voir `docs/regles-metier.md` pour le détail complet. Décisions actées le 2026-07-05 :

1. **Les rebuts consomment le packaging** (flacon, bouchon, étiquette) en plus de la matière première — un flacon rempli puis rejeté est considéré comme intégralement consommé.
2. **Le coût par flacon se calcule sur la quantité totale produite, rebuts inclus** (pas seulement la quantité conforme).
3. **Numéro de lot** : convention interne à conserver — 6 chiffres commençant par 455 (`455XXX`). Algorithme exact non encore fourni ; génération isolée dans un `LotNumberGeneratorService` dédié pour pouvoir l'implémenter/changer sans toucher au reste du MES.
4. **Contrôle qualité multi-type dès la V0.9** : plusieurs `QualityCheck` par lot, typés (`VISUEL`/`ORGANOLEPTIQUE`/`PHYSICO_CHIMIQUE`/`PACKAGING`/`DOCUMENTAIRE`), avec statut par contrôle (`CONFORME`/`NON_CONFORME`/`CONFORME_AVEC_RESERVE`) et un statut global du lot calculé (`EN_ATTENTE`/`CONFORME`/`NON_CONFORME`/`BLOQUE`). Pièces jointes : architecture prévue, upload non nécessairement exploité immédiatement.
5. **Traçabilité amont** : le stock est suivi par lot de réception (`StockLot` — fût, seau...), pas seulement en quantité globale par article, pour permettre un vrai rappel produit lot-à-lot en Jalon 3.
6. **Besoins attendus** : quantités à produire pour maintenir le stock de sécurité par référence (ni un prévisionnel pur, ni uniquement des commandes clients). Le MES affiche stock actuel/minimum/réservé/besoin calculé/quantité suggérée ; aucune automatisation de déclenchement en V0.9.

Ces décisions impactent le modèle de données du Jalon 2/3 — voir `docs/modele-donnees.md` (sections Stocks, Lots, Qualité, Besoins attendus) pour le détail des entités mises à jour (`StockLot`, `ExpectedRequirement`, `QualityCheckAttachment`...).

## 8. Points encore ouverts (à trancher pendant le Jalon 2/3, non bloquants pour démarrer)

- Algorithme exact de génération du numéro de lot (format confirmé, détail à fournir par l'utilisateur).
- Règle FIFO exacte d'affectation des `StockLot` lors d'une consommation (proposition par défaut : premier reçu, premier consommé).
- Formule exacte de `besoinCalculé`/`quantitéSuggérée` pour les besoins attendus.
- Règle exacte de calcul du statut qualité global du lot à partir des contrôles individuels (Jalon 3).
- Docker/`docker-compose.yml` écrits et raisonnés mais jamais exécutés avec un vrai Docker (non disponible dans l'environnement de développement utilisé).
- Vulnérabilités npm connues et non corrigées (transitives : `multer` via `@nestjs/platform-express`, `@hono/node-server` via l'outil dev de Prisma non utilisé) — à surveiller, et à traiter sérieusement dès que `multer` sera réellement exercé par l'upload de fichiers d'import au Jalon 2.

## 9. Prochaine étape

Jalon 2 — modules métier du cœur de production (catalogue, import OpenSi, stock avec suivi par lot, batching, production/génération de lot). Plan détaillé proposé, en attente de validation avant tout développement.
