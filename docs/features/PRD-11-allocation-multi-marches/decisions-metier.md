# PRD-11 — Décisions métier

Procès-verbal des décisions métier validées humainement pour la feature `PRD-11` (Allocation multi-marchés). Document déclaratif : aucune interprétation, aucun arbitrage technique — voir `revue-architecture.md` et `docs/adr/0006-allocation-marche-batch.md` pour la traduction en architecture.

## Contexte

Validé le 2026-07-16, avec l'utilisateur (responsable adjoint / product owner du projet).

Clarification préalable :
- LCA-MES reste mono-site.
- Le multi-marché ne signifie pas multi-site.
- Un marché est une destination commerciale ou réglementaire, par exemple France ou Suisse.

## Décisions métier validées (1ère série)

1. Un batch peut contenir plusieurs allocations de marché.
2. Une seule allocation par marché dans un même batch.
3. Une allocation génère exactement un lot fini.
4. Le mélange et la recette sont communs.
5. Le packaging peut différer selon le marché.
6. La répartition est définie avant le conditionnement.
7. Les rebuts sont suivis par allocation.
8. Les consommations de packaging sont calculées sur conforme + rebuts.
9. Le coût du mélange sera réparti proportionnellement ; le packaging sera calculé par allocation.
10. Les commandes, expéditions et règles réglementaires détaillées sont hors périmètre.

## Arbitrages complémentaires validés (2ème série, même date)

11. La généalogie est répartie proportionnellement aux volumes conformes uniquement.
12. Aucun backfill ni modification rétroactive des données historiques.
13. Les anciens batchs restent mono-marché.
14. `StockMovement` reçoit un `batchMarketAllocationId` nullable.

## Métadonnées de la feature

- ID : `PRD-11`
- Epic : 01 — Production
- Jalon cible : Jalon 2
- Statut : Spécifiée · Architecture validée · Prête pour développement
