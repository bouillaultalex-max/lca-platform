import { MappingConfig } from '../../common/column-mapping/column-mapping.types';

/**
 * Import Stocks : une ligne = une réception de lot, réutilise
 * `StockLotsService.receive()` (voir découpage Phase E). `articleReference` sert à
 * retrouver l'article existant par `openSiReference`, pas par son id interne.
 */
export const STOCKS_MAPPING_CONFIG: MappingConfig = {
  fields: [
    {
      key: 'articleReference',
      label: 'Référence article',
      required: true,
      type: 'string',
      synonyms: ['Référence', 'Réf.', 'SKU', 'Code article', 'Code OpenSi'],
    },
    {
      key: 'supplierLotNumber',
      label: 'Lot fournisseur',
      required: true,
      type: 'string',
      synonyms: ['Lot fournisseur', 'N° lot', 'Numéro de lot', 'Lot'],
    },
    {
      key: 'receivedQuantity',
      label: 'Quantité reçue',
      required: true,
      type: 'number',
      synonyms: ['Quantité', 'Qté', 'Quantité reçue'],
    },
    {
      key: 'receivedAt',
      label: 'Date de réception',
      required: true,
      type: 'date',
      synonyms: ['Date de réception', 'Date réception', 'Date'],
    },
    {
      key: 'expiryDate',
      label: 'Date de péremption',
      required: false,
      type: 'date',
      synonyms: ['Date de péremption', 'DLC', 'Péremption'],
    },
    {
      key: 'comment',
      label: 'Commentaire',
      required: false,
      type: 'string',
      synonyms: ['Commentaire', 'Remarque', 'Note'],
    },
  ],
};
