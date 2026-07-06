import { MappingConfig } from '../../common/column-mapping/column-mapping.types';
import { ARTICLES_MAPPING_CONFIG } from './articles.mapping-config';
import { STOCKS_MAPPING_CONFIG } from './stocks.mapping-config';
import { EXPECTED_REQUIREMENTS_MAPPING_CONFIG } from './expected-requirements.mapping-config';
import { INVENTORY_MAPPING_CONFIG } from './inventory.mapping-config';

/**
 * Registre des configurations de mapping OpenSi, par type d'entité (`entityType`
 * transmis à `ColumnMappingService`). Ajouter un futur connecteur (Magento, CRM...)
 * se fait par un nouveau fichier de config + un nouveau registre du même type,
 * jamais en modifiant le moteur générique.
 */
export const OPENSI_MAPPING_CONFIGS: Record<string, MappingConfig> = {
  ARTICLES: ARTICLES_MAPPING_CONFIG,
  STOCKS: STOCKS_MAPPING_CONFIG,
  BESOINS_ATTENDUS: EXPECTED_REQUIREMENTS_MAPPING_CONFIG,
  INVENTAIRE: INVENTORY_MAPPING_CONFIG,
};

export const IMPORT_SOURCE_OPENSI = 'OPENSI';
