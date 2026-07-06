import { MappingConfig } from '../../common/column-mapping/column-mapping.types';

/**
 * Import Inventaire : **volontairement minimal**. Décision confirmée (2026-07-06) —
 * la stratégie de rapprochement (par lot fournisseur ou par quantité globale) n'est pas
 * figée tant qu'un fichier réel OpenSi n'a pas été observé. `supplierLotNumber` reste
 * optionnel : sa présence ou son absence dans le mapping résultant est précisément le
 * signal que le futur service métier d'import Inventaire utilisera pour choisir sa
 * stratégie — cette config ne fait que rendre ce signal observable, sans décider.
 */
export const INVENTORY_MAPPING_CONFIG: MappingConfig = {
  fields: [
    {
      key: 'articleReference',
      label: 'Référence article',
      required: true,
      type: 'string',
      synonyms: ['Référence', 'Réf.', 'SKU', 'Code article', 'Code OpenSi'],
    },
    {
      key: 'countedQuantity',
      label: 'Quantité comptée',
      required: true,
      type: 'number',
      synonyms: ['Quantité', 'Qté', 'Stock physique', 'Quantité comptée'],
    },
    {
      key: 'supplierLotNumber',
      label: 'Lot fournisseur',
      required: false,
      type: 'string',
      synonyms: ['Lot fournisseur', 'N° lot', 'Numéro de lot', 'Lot'],
    },
  ],
};
