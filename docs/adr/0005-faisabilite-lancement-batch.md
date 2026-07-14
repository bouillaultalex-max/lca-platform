# ADR 0005 — Analyse de faisabilité avant lancement d'un batch

## Statut

Accepté — 2026-07-14

## Contexte

Retour métier important de Kevin (responsable laboratoire) lors des tests V0.3 : le logiciel permettait de faire passer un batch au statut `EN_COURS` même lorsque les matières premières disponibles étaient insuffisantes pour la quantité planifiée. Le problème n'était découvert qu'à la clôture du batch (`BatchClosureService`, qui vérifie déjà le stock avant de générer le lot) — trop tard, après que du temps et de la matière aient déjà été engagés en production réelle. Inacceptable pour le laboratoire.

Objectif : bloquer le lancement d'un batch dont les stocks sont insuffisants, informer précisément l'utilisateur de ce qui manque, et calculer automatiquement la quantité maximale réellement produisible — sans jamais dupliquer ni faire diverger la logique de vérification déjà existante à la clôture, et sans introduire de décrémentation de stock au lancement.

## Décision

1. **Le contrôle est inséré au seul point où il a un sens** : le premier appel à `BatchStepsService.advance()` (transition `PLANIFIE` → `EN_COURS`/`PREPARATION`), pas ailleurs. Les avancées suivantes du workflow (mélange → incorporation trémie → conditionnement) ne consomment aucun stock supplémentaire dans ce modèle (la déduction reste exclusivement à la clôture, voir `docs/regles-metier.md` §3) et ne sont donc jamais revérifiées.
2. **Nouveau `BatchFeasibilityService`** (module `batching`, à côté de `batch-preparation`) qui réutilise **sans les modifier** deux briques déjà existantes et déjà utilisées par la clôture : `BatchPreparationService.computeIngredientQuantities()` (besoin réel par article, à partir de la recette et de la quantité) et `computeFifoAllocations()` (fonction pure de comparaison stock disponible / besoin, déjà utilisée par `BatchClosureService`). Cette réutilisation garantit, par construction, que le contrôle au lancement et celui à la clôture ne peuvent jamais diverger — pas seulement aujourd'hui, mais aussi si l'un des deux calculs évolue plus tard.
3. **Double vérification, même principe que les imports OpenSi (prévisualisation puis reconfirmation serveur, voir `docs/regles-metier.md` §7)** : un endpoint de consultation `GET /batching/batches/:id/feasibility`, purement en lecture, alimente un modal côté frontend. `BatchStepsService.advance()` revérifie ensuite la faisabilité de façon totalement indépendante, juste avant d'écrire la transition — sans jamais faire confiance à ce que le frontend a pu afficher quelques secondes plus tôt. Un changement de stock entre-temps (autre batch lancé, correction d'inventaire) est donc toujours intercepté côté serveur, jamais seulement côté client.
4. **Quantité maximale produisible = le minimum, sur l'ensemble des composants de la recette, de (stock disponible ÷ taux de consommation par unité)**, taux dérivé directement du besoin déjà calculé (`quantité nécessaire ÷ quantité demandée`) plutôt que dupliqué depuis la distinction matière première (pourcentage de volume) / packaging (quantité absolue). Toujours arrondi à l'entier inférieur (jamais promettre une quantité que le stock ne peut pas réellement couvrir) ; un composant à taux de consommation nul est exclu du calcul (pas de division par zéro).
5. **Nouveau `PATCH /batching/batches/:id/planned-quantity`**, autorisé uniquement tant que `Batch.status === PLANIFIE` : permet d'ajuster la quantité planifiée (typiquement à la quantité maximale calculée), toujours sur action explicite de l'utilisateur, jamais automatiquement.
6. **Aucune décrémentation de stock au lancement** : le nouveau service est strictement en lecture (aucune écriture, aucune transaction). La règle métier de déduction de stock exclusivement à la clôture (§3) n'est pas modifiée.

## Alternatives envisagées et écartées

- **Dupliquer la logique de comparaison stock/besoin dans un nouveau code indépendant de celui de la clôture** : écarté — risque de divergence future entre les deux vérifications (ex. correction d'un bug d'arrondi appliquée à un seul des deux endroits), alors que la garantie recherchée par l'utilisateur est précisément qu'elles restent toujours cohérentes.
- **Faire confiance au frontend après une unique vérification "aperçu"** (pas de revérification au lancement réel) : écarté — violerait la contrainte explicite "toutes les vérifications critiques doivent rester côté serveur" et laisserait une fenêtre de race condition (stock modifié entre l'aperçu et le clic réel de lancement).
- **Réserver le stock au lancement** (décrémenter par anticipation, pour interdire tout autre batch de consommer la même matière) : écarté pour la V0.9, à la demande explicite de l'utilisateur — un système de réservation de stock est une évolution future distincte, non conçue ici.
- **Bloquer silencieusement le lancement sans indiquer la quantité maximale produisible** : écarté — l'utilisateur a explicitement demandé un calcul automatique de cette quantité, pour permettre une décision éclairée (attendre un réapprovisionnement, ou produire moins que prévu) plutôt qu'un simple refus.

## Conséquences

- Toute tentative de lancement d'un batch avec un stock insuffisant est bloquée avant tout engagement réel de temps ou de matière, avec un détail précis (article, référence, quantité nécessaire, disponible, manquante, unité) et une quantité maximale produisible calculée automatiquement.
- Le motif de rejet à la clôture (`BatchClosureService`, message agrégé en texte libre) n'a pas été modifié — seul le nouveau contrôle au lancement introduit une réponse structurée (`BatchFeasibilityReport`), plus riche, car destinée à alimenter un modal détaillé plutôt qu'un simple message d'erreur.
- `MaterialQuantity`/`PackagingQuantity` (type partagé `IngredientQuantity`, déjà utilisé par l'aperçu volume/masse à la création d'un batch) ont reçu un champ additif `articleReference`, pour éviter une requête dupliquée dans le nouveau service — aucun champ existant retiré ni renommé, aucune régression sur l'aperçu déjà en place.
- Si un futur écran nécessite un contrôle similaire "aperçu avant action irréversible, revérifié indépendamment à l'exécution réelle" (ex. futur module `planning`), le même patron (endpoint de consultation + revérification serveur au moment de l'écriture) pourra être réutilisé — déjà observé une première fois avec les imports OpenSi (ADR implicite, voir `docs/regles-metier.md` §7), confirmé une seconde fois ici.
