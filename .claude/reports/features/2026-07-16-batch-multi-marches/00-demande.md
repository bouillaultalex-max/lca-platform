# Demande — Batch multi-marchés

## Identifiant

`2026-07-16-batch-multi-marches`

## Statut

PRÊT POUR SPÉCIFICATION

## Demande initiale

Permettre de répartir un même batch de fabrication entre plusieurs marchés.

Exemple :

- France : 3 000 flacons
- Suisse : 600 flacons

## Décisions métier validées

- Un marché correspond à une destination commerciale ou réglementaire.
- Le mélange et la recette sont communs aux différents marchés.
- Le produit fini et certains composants de packaging peuvent varier selon le marché.
- La répartition est définie avant le conditionnement.
- Un batch possède plusieurs allocations de marché.
- Les quantités conformes et les rebuts sont enregistrés par allocation.
- Le packaging est consommé sur la quantité conforme plus les rebuts.
- Un batch peut produire plusieurs lots finis.
- Un lot fini est généré pour chaque allocation marché.
- Le coût du mélange est réparti entre les allocations.
- Le coût du packaging est calculé séparément pour chaque allocation.
- Les commandes, expéditions et règles réglementaires détaillées sont hors périmètre.

## Workflow prévu

1. Spécification PO
2. Revue d’architecture
3. Validation humaine
4. ADR
5. Plan de développement
6. Développement
7. QA
8. Documentation
9. Rapport final

## Conditions connues

- La cardinalité actuelle Batch vers Lot devra évoluer.
- La faisabilité doit agréger les besoins par article avant comparaison au stock.
- Un ADR est obligatoire.
- Aucun développement ne commence avant validation humaine.