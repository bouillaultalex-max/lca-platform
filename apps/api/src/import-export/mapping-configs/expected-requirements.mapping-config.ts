import { MappingConfig } from '../../common/column-mapping/column-mapping.types';

/**
 * Import Besoins attendus : chaque ligne crée toujours un nouvel `ExpectedRequirement`
 * (jamais de mise à jour, voir docs/regles-metier.md §8). `importedAt` reste optionnel
 * au niveau du mapping — sa valeur par défaut éventuelle (date de traitement du fichier)
 * est une décision du service métier d'import (E5+), pas de ce moteur générique.
 */
export const EXPECTED_REQUIREMENTS_MAPPING_CONFIG: MappingConfig = {
  fields: [
    {
      key: 'articleReference',
      label: 'Référence article',
      required: true,
      type: 'string',
      synonyms: ['Référence', 'Réf.', 'SKU', 'Code article', 'Code OpenSi'],
    },
    {
      key: 'importedRequirement',
      label: 'Besoin attendu',
      required: true,
      type: 'number',
      synonyms: ['Besoin', 'Besoin attendu', 'Quantité à produire'],
    },
    {
      key: 'reservedQuantity',
      label: 'Quantité réservée',
      required: false,
      type: 'number',
      synonyms: ['Réservé', 'Quantité réservée', 'Commandes'],
    },
    {
      key: 'importedAt',
      label: "Date de l'import",
      required: false,
      type: 'date',
      synonyms: ['Date', "Date d'import", 'Date besoin'],
    },
  ],
};
