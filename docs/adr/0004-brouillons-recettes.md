# ADR 0004 — Brouillons de recettes (autosave)

## Statut

Accepté — 2026-07-14

## Contexte

Premier retour utilisateur de Kevin (responsable laboratoire) lors des tests V0.3 : la création d'une recette se fait dans un formulaire unique, sans aucune persistance avant le clic final sur "Créer la version". Si l'utilisateur quitte l'écran, change d'onglet ou est déconnecté avant de valider, toute la saisie en cours est perdue silencieusement.

Objectif : permettre de reprendre une saisie de recette interrompue, exactement là où l'utilisateur s'était arrêté, sans jamais publier automatiquement une recette et sans jamais perdre de données silencieusement.

## Décision

1. **Table dédiée `RecipeDraft`**, distincte de `Recipe`/`RecipeLine` : un brouillon ne subit aucune des contraintes métier de la recette officielle (pourcentage total à 100 %, articles actifs, unicité des lignes...). Son contenu (`format`, `lines`) est stocké en `Json` libre, potentiellement partiel ou invalide — la validation n'intervient qu'à la création finale via `RecipesService.create`. Un brouillon n'apparaît donc jamais, structurellement, dans la liste des recettes officielles.
2. **Un seul brouillon par utilisateur et par produit fini** (`@@unique([userId, finishedProductId])`) : un même utilisateur peut avoir des brouillons en attente sur plusieurs produits, mais un seul par produit. Le `format` fait partie du contenu, pas de la clé — changer de format en cours de saisie ne crée pas un nouveau brouillon.
3. **Autosave frontend** (hook `useRecipeDraftAutosave`) : debounce de 2 s après chaque modification, sauvegarde forcée toutes les 15 s en cas de saisie continue, flush immédiat au changement d'onglet (`visibilitychange`) et à la navigation/fermeture (`beforeunload` + démontage du composant, avec `fetch(..., { keepalive: true })` pour survivre à la fermeture de la page). Volontairement **pas** de sauvegarde sur simple perte de focus d'un champ (décision explicite de l'utilisateur).
4. **Détection de conflit optimiste** : chaque enregistrement envoie le `updatedAt` du brouillon tel que connu par cet onglet (`expectedUpdatedAt`). Si le serveur détecte un écart (modifié depuis un autre onglet/poste), il répond `409 Conflict` et le frontend affiche un bandeau explicite ("Ce brouillon a été modifié depuis un autre poste ou un autre onglet.") avec deux actions : recharger la version serveur, ou forcer l'enregistrement de la version locale. Jamais d'écrasement silencieux.
5. **Trois actions explicites lorsqu'un brouillon existant est détecté** : Reprendre (contenu identique), Dupliquer (composition copiée, format vidé — utile pour une variante), Supprimer. "Dupliquer" ne sauvegarde rien immédiatement : la copie ne remplace le brouillon original qu'au moment où l'autosave normal se déclenche sur une vraie modification ultérieure, jamais au clic lui-même.
6. **Suppression automatique du brouillon à la création finale réussie** : `RecipesService.create` supprime, dans la même transaction, tout brouillon existant pour ce produit fini sur le site (tous utilisateurs confondus, puisqu'une recette validée rend caduque toute saisie en cours sur ce même produit).
7. **Aucune trace dans `AuditLog`** : un brouillon reste une donnée temporaire de travail, pas une écriture métier — cohérent avec le périmètre actuel d'`AuditLog` (réservé à l'administration des comptes), qui ne trace pas non plus la création des recettes elles-mêmes.

## Alternatives envisagées et écartées

- **Brouillon unique global par utilisateur (tous produits confondus)** : écarté — un utilisateur travaillant sur deux produits en parallèle (ex. deux onglets) perdrait silencieusement l'un des deux brouillons.
- **Verrouillage exclusif du brouillon (pessimiste)** en cas d'édition concurrente : écarté pour la V0.9 — disproportionné pour une équipe de 2 postes ; la détection optimiste par `409` avec choix explicite suffit et reste plus simple.
- **Réutilisation de `RecipeLine`/contraintes existantes pour stocker les brouillons** : écartée — les lignes de brouillon doivent pouvoir être incomplètes/invalides en cours de saisie, ce qu'un modèle relationnel avec clés étrangères et contraintes NOT NULL ne permet pas sans complexifier fortement le modèle.
- **Sauvegarde sur perte de focus (`blur`)** : écartée à la demande explicite de l'utilisateur, en plus du debounce/15 s/changement d'onglet/navigation déjà couverts.
- **Traçage des brouillons dans `AuditLog`** : écarté à la demande explicite de l'utilisateur — donnée temporaire, pas une écriture métier à auditer.

## Conséquences

- Toute reprise de recette interrompue (navigation, F5, reconnexion) fonctionne sans perte de données, avec un signal visuel clair de l'état de sauvegarde ("Brouillon enregistré à HH:mm").
- Le modèle `RecipeDraft` introduit le premier usage d'un champ `Json` libre dans le schéma pour du contenu métier (hors `AuditLog.before/after`, déjà existant) : à garder à l'esprit si un futur brouillon similaire est envisagé pour un autre écran (ex. batching), le même patron pourra être réutilisé.
- Le bug de routage NestJS découvert pendant l'implémentation (une route littérale `catalog/recipes/drafts` doit être déclarée dans un contrôleur enregistré **avant** un contrôleur exposant une route paramétrée `catalog/recipes/:id`, sous peine d'être interceptée par cette dernière) est corrigé dans `CatalogModule` et documenté en commentaire — point de vigilance pour tout futur ajout de sous-ressource sous une route déjà paramétrée.
