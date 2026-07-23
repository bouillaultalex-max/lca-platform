# CLAUDE.md — Instructions pour Claude Code sur LCA-MES

## Contexte

LCA-MES est un logiciel de gestion de production pour le laboratoire de LCA Distribution (marque Maison Fuel). Le projet est développé par une seule personne, non-développeuse professionnelle (Alexandre Bouillault, responsable adjoint laboratoire), avec Claude Code comme développeur assistant principal.

Avant toute intervention significative sur ce projet, lire :
- `MASTER_SPECIFICATION.md`
- `docs/architecture.md`
- `docs/modele-donnees.md`
- `docs/regles-metier.md`
- `docs/roadmap.md`
- `docs/adr/` (décisions déjà prises, à ne pas remettre en cause sans discussion explicite)

## Principes d'architecture à respecter

- **Monolithe modulaire NestJS.** Pas de microservices, pas de message broker, pas de gateway edge en V0.9.
- Un module Nest par domaine métier : `catalog`, `stock`, `batching`, `production`, `traceability`, `quality`, `costing`, `import-export`, `auth`, `audit-log`. La logique métier vit dans les services, jamais dans les controllers.
- Module `assistant` (voir ci-dessous, AI-01/AI-02) : infrastructure de l'assistant IA — orchestrateur, abstraction `AiProvider`, registre d'outils métier. Ne doit jamais accéder directement à la base ni contourner les guards/permissions existants : passe systématiquement par les services métier déjà en place.
- **Prisma schema = source unique de vérité** du modèle de données. Toute évolution de modèle passe par une migration Prisma versionnée, jamais par une modification manuelle de la base.
- **Un seul processus backend** sert l'API et les fichiers statiques du build React (un seul port, pas de CORS à gérer en interne).
- **Une seule base PostgreSQL**, aucune duplication.
- Colonne `siteId` prévue dès le départ sur les entités concernées, même si un seul site existe en V0.9 (voir `docs/architecture.md`).
- Traçabilité métier (généalogie lot ↔ matières/packaging consommés) et journal d'audit technique sont **non négociables** — voir `docs/regles-metier.md`.
- Tout import de fichier (OpenSi) doit passer par une étape de prévisualisation (dry-run) avant écriture en base, et être journalisé.

## Ce qui est explicitement HORS PÉRIMÈTRE V0.9

Ne pas implémenter, ni suggérer d'implémenter sans validation explicite de l'utilisateur :
- Connexion machine (OPC-UA, Modbus, MQTT), gateway edge, IoT
- Multi-site complet / multi-tenant
- Application mobile
- IA avancée, optimisation de planning — **exception explicite et assumée (2026-07-23, voir `docs/roadmap.md`)** : le socle d'infrastructure de l'assistant IA (module `assistant`, tickets AI-01/AI-02) est une extension de périmètre volontaire, à portée strictement limitée à l'infrastructure (aucun outil métier, aucune action, aucun fournisseur IA réel branché). Toute extension au-delà de ce socle (outils métier, actions, planning) reste hors périmètre tant qu'elle n'a pas fait l'objet d'une validation explicite équivalente, ticket par ticket.

Ces éléments sont des évolutions futures anticipées dans l'architecture (points d'extension documentés) mais ne doivent **pas** être codés par avance.

## Conventions de développement

- TypeScript partout, mode strict activé.
- **Pas de Docker requis pour le développement local** : npm + PostgreSQL local + Prisma + NestJS + React/Vite. Docker Compose reste réservé au déploiement, à ajouter plus tard sans jamais complexifier le démarrage local.
- Tests obligatoires sur la logique à risque métier/financier : calcul de coût par flacon, déduction de stock lors d'un batch, généalogie de lot. Pas d'obligation de couverture totale ailleurs.
- Toute décision structurante nouvelle donne lieu à un ADR dans `docs/adr/` (copier le format de `0001-architecture-v09.md`).
- Rôles utilisateurs : `RESPONSABLE_LABORATOIRE` et `RESPONSABLE_ADJOINT` ont un accès complet ; `DIRECTION` et `DAF` sont strictement en lecture seule (rapports, statistiques, coûts, stocks, tableaux de bord — pas d'accès aux écrans de saisie/édition).

## Manière de collaborer

- L'utilisateur n'est pas développeur professionnel : privilégier des explications claires, éviter le jargon non expliqué, proposer des solutions simples avant des solutions sophistiquées.
- Ne pas générer de code applicatif (NestJS/React) sans validation explicite préalable d'un jalon ou d'une fonctionnalité précise.
- Avant d'introduire une dépendance ou un pattern non mentionné dans `docs/architecture.md`, le signaler et demander confirmation plutôt que de décider seul.
- Le calendrier est serré (MVP visé fin août 2026, voir `docs/roadmap.md`) : en cas de tension entre simplicité et exhaustivité, signaler l'arbitrage à l'utilisateur plutôt que de trancher silencieusement.
