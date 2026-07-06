import { MappingConfig } from '../../common/column-mapping/column-mapping.types';

/**
 * Champs OpenSi réellement possédés par l'import Articles (voir docs/regles-metier.md §7) :
 * ne touche jamais `active`, `unitsPerCarton`, `densityKgPerL` (propres à LCA-MES, jamais
 * écrasés par un import).
 */
export const ARTICLES_MAPPING_CONFIG: MappingConfig = {
  fields: [
    {
      key: 'type',
      label: "Type d'article",
      required: true,
      type: 'string',
      synonyms: ['Type', 'Type article', 'Catégorie', 'Famille'],
    },
    {
      key: 'openSiReference',
      label: 'Référence OpenSi',
      required: true,
      type: 'string',
      synonyms: ['Référence', 'Réf.', 'SKU', 'Code article', 'Code OpenSi'],
    },
    {
      key: 'name',
      label: 'Désignation',
      required: true,
      type: 'string',
      synonyms: ['Désignation', 'Nom', 'Libellé', 'Produit'],
    },
    {
      key: 'unitOfMeasure',
      label: 'Unité de mesure',
      required: true,
      type: 'string',
      synonyms: ['Unité', 'UM', 'Unité de mesure'],
    },
    {
      key: 'currentUnitCost',
      label: 'Coût unitaire',
      required: true,
      type: 'number',
      synonyms: ['Prix', 'Coût', 'PA', 'Prix achat', "Prix d'achat"],
    },
  ],
};
