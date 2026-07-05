# ADR 0001 — Architecture de LCA-MES V0.9

## Statut

Accepté — 2026-07-05

## Contexte

LCA-MES est un logiciel de gestion de production pour le laboratoire de LCA Distribution (marque Maison Fuel), développé par une seule personne non-développeuse professionnelle, assistée de Claude Code. La V0.9 doit couvrir le cœur métier (catalogue, recettes, matières premières, packaging, stocks, imports OpenSi, batching, production, lots, traçabilité, contrôle qualité simple, coût par flacon) pour une échéance fin août 2026, dans un contexte :

- on-premise, accès depuis 2 postes du réseau local du laboratoire (+ consultation direction/DAF)
- 1 seul site de production, 1 machine active (2 CDA E-Fill + 1 machine 30 ml prévues sous ~3 mois)
- pas d'intégration technique directe avec l'ERP existant (OpenSi) en V0.9
- exigence de traçabilité forte, de sauvegardes automatiques, de code maintenable et de documentation systématique

## Décision

1. **Monolithe modulaire NestJS**, découpé par domaine métier (`catalog`, `stock`, `batching`, `production`, `traceability`, `quality`, `costing`, `import-export`, `auth`, `audit-log`) — pas de microservices, pas de message broker, pas de gateway edge en V0.9.
2. **Frontend React + Vite + TypeScript + Tailwind CSS**, servi par le backend NestJS en production (un seul processus, un seul port).
3. **PostgreSQL unique** comme unique base de données, aucune duplication.
4. **Prisma** comme ORM et source unique de vérité du modèle de données (migrations versionnées).
5. **Aucune dépendance à Docker pour le développement local** : le projet démarre avec npm + PostgreSQL local + Prisma + NestJS + React/Vite. Docker Compose sera introduit plus tard, uniquement comme option de déploiement sur le poste du laboratoire.
6. **Quatre rôles utilisateurs** : `RESPONSABLE_LABORATOIRE` et `RESPONSABLE_ADJOINT` (accès complet), `DIRECTION` et `DAF` (lecture seule : rapports, statistiques, coûts, stocks, tableaux de bord).
7. **Pas d'intégration machine ni ERP directe en V0.9** : saisie manuelle des données de production, imports/exports OpenSi par Excel/CSV avec prévisualisation obligatoire.
8. **Préparation multi-site minimale** : une colonne `siteId` sur les entités concernées dès la V0.9, sans fonctionnalité multi-site développée.
9. **Traçabilité métier dédiée** : table de généalogie (`LotGenealogy`) distincte du journal d'audit technique (`AuditLog`).

## Alternatives envisagées et écartées

- **Microservices** : écarté — complexité opérationnelle (réseau, cohérence, déploiement) non justifiée pour 2 utilisateurs actifs et un développeur solo.
- **Architecture événementielle avec broker de messages (Kafka/RabbitMQ/MQTT)** : écartée pour la V0.9 — aucune source de données temps réel (pas de connexion machine), donc aucun besoin de découplage asynchrone à ce stade.
- **Gateway edge + protocoles industriels (OPC-UA/Modbus)** : écarté pour la V0.9 — aucune machine connectée actuellement ; prévu comme évolution future une fois la connexion machine justifiée.
- **Docker obligatoire dès le développement** : écarté à la demande explicite de l'utilisateur — le poste de développement doit rester simple à démarrer (npm + PostgreSQL local).
- **Base de données par site (multi-tenant physique)** : écartée pour la V0.9 — un seul site existe ; la préparation se limite à une colonne `siteId`, pas à une architecture multi-tenant complète.

## Conséquences

- Le système reste simple à comprendre, développer et maintenir par une seule personne assistée d'IA.
- L'évolution vers la connexion machine ou le multi-site complet nécessitera une nouvelle décision d'architecture (nouvel ADR) le moment venu, mais les frontières de modules et le modèle de données actuels sont conçus pour ne pas nécessiter de refonte lourde.
- L'absence d'intégration ERP directe implique une charge opérationnelle manuelle (imports/exports de fichiers) qui devra être suivie en usage réel et pourra justifier une intégration directe dans une version ultérieure si le volume le justifie.
