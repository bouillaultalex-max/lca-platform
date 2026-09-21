# Environnement de démonstration/test DAF

## Qu'est-ce que c'est

Une instance LCA-MES **complètement indépendante** de l'environnement de
développement (`lca_mes_dev`) et de tests automatisés (`lca_mes_test`),
destinée à permettre au DAF (ou à toute personne en dehors de l'équipe
de développement) de manipuler librement le logiciel — créer/modifier/
supprimer des articles, recettes, stocks, batchs, lancer/annuler/clôturer
des batchs, consulter la traçabilité, l'impression d'étiquettes — sans
aucun risque d'altérer les données réelles de développement.

Elle repose sur :
- une base PostgreSQL dédiée, `lca_mes_demo` (même instance PostgreSQL
  locale que `lca_mes_dev`/`lca_mes_test`, rôle `lca_mes` réutilisé,
  base physiquement distincte) ;
- un fichier d'environnement dédié, `apps/api/.env.demo` (non commité,
  voir `.gitignore`) ;
- un backend NestJS démarré sur le **port 3002** (dev = 3000, tests
  automatisés = 3001), servant aussi le frontend compilé (mono-processus,
  comme en production).

## Indépendance vis-à-vis de `lca_mes_dev`

- Base de données strictement séparée : aucune table, aucune ligne
  partagée avec `lca_mes_dev` ou `lca_mes_test`.
- `seed-demo.ts` et `reset-demo.ts` embarquent un garde-fou
  (`prisma/demo-database-guard.ts`) qui **refuse immédiatement** de
  s'exécuter si `DATABASE_URL` ne pointe pas exactement vers
  `lca_mes_demo` — y compris si elle pointe vers `lca_mes_dev` ou
  `lca_mes_test`. Aucune connexion n'est ouverte avant cette vérification.
- Le compteur de numérotation de lots démo démarre à **100000**
  (prochain numéro émis : 100001) — une valeur purement conventionnelle,
  sans aucun rapport avec la numérotation réelle du laboratoire (qui,
  elle, dépasse déjà 455000). Voir ADR 0010 § Décision 7 : sur un site
  sans aucun `Lot` historique, n'importe quelle valeur de départ ≥ 0
  respecte l'invariant — 100000 a été choisi pour qu'il soit visuellement
  impossible de confondre un numéro de lot démo avec un numéro réel.

**Règle absolue : ne jamais lancer `seed-demo.ts` ou `reset-demo.ts`
avec la `DATABASE_URL` de `.env` ou `.env.test`.** Le garde-fou bloque
cette erreur, mais la prudence reste de mise : toujours vérifier le nom
de base affiché en tout début d'exécution avant de continuer.

## Démarrer l'instance démo

Prérequis : la base `lca_mes_demo` existe et est peuplée (voir plus bas
si ce n'est pas le cas — section « Recréer l'environnement »).

```bash
cd apps/api
npm run build            # si pas déjà fait / si le code a changé
node --env-file=.env.demo dist/src/main
```

Le backend démarre sur `http://localhost:3002` et sert aussi le
frontend (mono-processus). Si le dossier `apps/api/dist/public` est
absent ou obsolète (le build backend seul ne copie pas le frontend),
reconstruire le frontend et le copier manuellement :

```bash
cd apps/web && npm run build
cd ../api && npm run build
mkdir -p dist/public && cp -r ../web/dist/* dist/public/
```

Ceci n'affecte jamais l'instance de développement sur le port 3000 :
ce sont deux processus Node distincts, avec deux bases distinctes.

## URL à ouvrir

**http://localhost:3002/**

(Documentation Swagger de l'API démo, si besoin : `http://localhost:3002/api/docs`.)

## Comptes de démonstration

| Rôle | Email | Mot de passe |
|---|---|---|
| Responsable laboratoire (accès complet + admin) | `responsable.demo@lca-mes.local` | `DemoLCA2026!` |
| Responsable adjoint (accès complet) | `adjoint.demo@lca-mes.local` | `DemoLCA2026!` |
| Direction (lecture seule) | `direction.demo@lca-mes.local` | `DemoLCA2026!` |
| DAF (lecture seule) | `daf.demo@lca-mes.local` | `DemoLCA2026!` |

Mots de passe non sensibles, propres à cet environnement de démonstration
uniquement — ne jamais réutiliser les comptes réels de `lca_mes_dev`.

## Données initiales

À chaque (re)génération via `seed-demo.ts` (idempotent, ne duplique rien
si relancé) :
- 1 site : « Laboratoire LCA Distribution » ;
- les 4 comptes ci-dessus ;
- 1 machine active : « DEMO — Machine de conditionnement » ;
- 5 articles : 2 matières premières (Parfum Vanille, Glycérine végétale),
  2 packagings (Flacon 100 ml, Bouchon), 1 produit fini (Recharge Vanille
  100 ml) — tous préfixés « DEMO — » pour être immédiatement identifiables ;
- du stock suffisant sur les 2 matières premières et les 2 packagings
  pour que la recette démo soit réellement faisable ;
- 1 recette active, format 100 ml, utilisant les articles démo ;
- le compteur de numérotation de lots, prêt à émettre à partir de 100001 ;
- **aucun** batch, lot, mouvement de stock ou journal d'audit historique.

## Réinitialiser complètement l'environnement

Pour rendre l'environnement à nouveau strictement vierge (recommandé
avant chaque nouvelle session de démonstration si le DAF a créé/modifié
des données) :

```bash
cd apps/api
DATABASE_URL="postgresql://lca_mes:<mot_de_passe>@localhost:5432/lca_mes_demo?schema=public" \
  CONFIRM=yes npx tsx prisma/reset-demo.ts
```

(ou `npm run prisma:reset:demo` si `.env.demo` est déjà en place — le
script charge alors automatiquement la bonne `DATABASE_URL`).

Ce script :
1. termine toute connexion active à `lca_mes_demo` ;
2. **supprime intégralement** la base (`DROP DATABASE`) ;
3. la recrée (owner `lca_mes`) ;
4. réapplique les migrations Prisma existantes (`prisma migrate deploy`,
   jamais de nouvelle migration générée) ;
5. relance `seed-demo.ts`.

Sans `CONFIRM=yes` (ou `--yes`), le script **ne fait rien** : il décrit
seulement ce qu'il ferait. Aucune suppression accidentelle possible.

## Recréer l'environnement depuis zéro (si la base n'existe pas encore)

```bash
# 1. Créer la base (une seule fois)
psql -U postgres -c "CREATE DATABASE lca_mes_demo OWNER lca_mes;"

# 2. Appliquer les migrations existantes (jamais prisma migrate dev ici)
cd apps/api
DATABASE_URL="postgresql://lca_mes:<mot_de_passe>@localhost:5432/lca_mes_demo?schema=public" \
  npx prisma migrate deploy

# 3. Peupler les données de démonstration
DATABASE_URL="postgresql://lca_mes:<mot_de_passe>@localhost:5432/lca_mes_demo?schema=public" \
  npx tsx prisma/seed-demo.ts
```

Ou plus simplement, une fois `.env.demo` en place : `npm run
prisma:seed:demo`.

## Précautions — ne jamais toucher `lca_mes_dev`

- `apps/api/.env` (dev) et `apps/api/.env.test` (tests automatisés) ne
  sont **jamais** modifiés par ces scripts.
- `prisma/seed.ts` et `prisma/bootstrap-admin.ts` (dev) restent
  totalement inchangés et indépendants de `seed-demo.ts`/`reset-demo.ts`.
- `seed-demo.ts` et `reset-demo.ts` doivent **toujours** être lancés
  avec une `DATABASE_URL` explicite ciblant `lca_mes_demo` — jamais une
  valeur héritée implicitement. Le garde-fou refuse toute autre cible.
- Ne jamais copier de données réelles de `lca_mes_dev` vers
  `lca_mes_demo` : l'environnement démo doit rester composé uniquement
  de données fictives, clairement préfixées « DEMO — ».
