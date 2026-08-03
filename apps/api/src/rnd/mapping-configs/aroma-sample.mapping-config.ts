import { MappingConfig } from '../../common/column-mapping/column-mapping.types';

/**
 * Import Aromathèque (R&D, voir RD-01) : source distincte d'OpenSi, feuille unique
 * `🗂 Aromatèque Complète` (nom choisi et transmis par le service métier consommateur,
 * jamais ici — cette configuration ne connaît aucun fichier ni aucune feuille).
 * `EF-0378` est le nom réel, mais accidentel, de la première colonne du fichier
 * source (identifiant historique) — conservé tel quel en synonyme explicite, au même
 * titre que les codes très spécifiques déjà en dur dans `articles.mapping-config.ts`
 * (ex: `'PA'`). Seuls `legacyId`, `supplierNameRaw` et `productName` sont obligatoires
 * (voir docs/regles-metier.md — décisions R&D validées) ; `category` reste facultative
 * ici, sa valeur par défaut "Autre" étant une décision du futur service métier
 * d'import, pas de cette configuration (voir `column-mapping.service.ts` §"Aucune
 * coercition de valeur dans le moteur").
 */
export const AROMA_SAMPLE_MAPPING_CONFIG: MappingConfig = {
  fields: [
    {
      key: 'legacyId',
      label: 'Identifiant historique',
      required: true,
      type: 'string',
      synonyms: ['EF-0378', 'ID', 'Identifiant', 'Identifiant historique'],
    },
    {
      key: 'supplierNameRaw',
      label: 'Fournisseur',
      required: true,
      type: 'string',
      synonyms: ['Fournisseur', 'Supplier', 'Nom fournisseur'],
    },
    {
      key: 'productName',
      label: 'Produit / Arôme',
      required: true,
      type: 'string',
      synonyms: [
        'Produit / Arôme',
        'Produit/Arôme',
        'Produit',
        'Arôme',
        'Arome',
        'Nom arôme',
      ],
    },
    {
      key: 'supplierReference',
      label: 'Référence fournisseur',
      required: false,
      type: 'string',
      synonyms: [
        'Référence',
        'Reference',
        'Référence fournisseur',
        'Supplier reference',
      ],
    },
    {
      key: 'category',
      label: 'Catégorie',
      required: false,
      type: 'string',
      synonyms: ['Catégorie', 'Categorie', 'Category'],
    },
    {
      key: 'rating',
      label: 'Note',
      required: false,
      type: 'number',
      synonyms: ['Note ★', 'Note', 'Rating'],
    },
    {
      key: 'stockGrams',
      label: 'Stock (g)',
      required: false,
      type: 'number',
      synonyms: ['Stock (g)', 'Stock g', 'Stock grammes'],
    },
    {
      key: 'pricePerKgEur',
      label: 'Prix par kg (€)',
      required: false,
      type: 'number',
      synonyms: ['Prix/kg (€)', 'Prix/kg', 'Prix par kg', 'Prix kg EUR'],
    },
    {
      key: 'addedAt',
      label: "Date d'ajout",
      required: false,
      type: 'date',
      synonyms: ['Date ajout', "Date d'ajout", 'Added at'],
    },
    {
      key: 'comment',
      label: 'Commentaire',
      required: false,
      type: 'string',
      synonyms: ['Commentaire', 'Comment', 'Comments', 'Notes'],
    },
  ],
};
