import { ColumnMappingService } from '../../common/column-mapping/column-mapping.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AROMA_SAMPLE_MAPPING_CONFIG } from './aroma-sample.mapping-config';

/**
 * Vérifie la configuration métier `AROMA_SAMPLE_MAPPING_CONFIG` avec le moteur réel
 * `ColumnMappingService` (voir `column-mapping.service.spec.ts` pour le même patron
 * de test appliqué au moteur générique). Aucune donnée du fichier Excel réel n'est
 * lue ici : uniquement les 10 intitulés de colonnes réels, recopiés tels quels.
 */
describe('AROMA_SAMPLE_MAPPING_CONFIG', () => {
  let service: ColumnMappingService;
  let prisma: {
    columnMappingRule: { findMany: jest.Mock<Promise<unknown[]>, [unknown]> };
  };

  const siteId = 'site-1';
  const source = 'AROMATHEQUE_EXCEL';
  const entityType = 'AROMA_SAMPLE';

  // Intitulés réels de la feuille source "🗂 Aromatèque Complète".
  const realHeaders = [
    'EF-0378',
    'Fournisseur',
    'Produit / Arôme',
    'Référence',
    'Catégorie',
    'Note ★',
    'Stock (g)',
    'Prix/kg (€)',
    'Date ajout',
    'Commentaire',
  ];

  beforeEach(() => {
    prisma = {
      columnMappingRule: {
        findMany: jest
          .fn<Promise<unknown[]>, [unknown]>()
          .mockResolvedValue([]),
      },
    };
    service = new ColumnMappingService(prisma as unknown as PrismaService);
  });

  it('déclare exactement les 3 champs obligatoires attendus, aucun autre', () => {
    const requiredKeys = AROMA_SAMPLE_MAPPING_CONFIG.fields
      .filter((field) => field.required)
      .map((field) => field.key);

    expect(requiredKeys.sort()).toEqual(
      ['legacyId', 'productName', 'supplierNameRaw'].sort(),
    );
  });

  it('ne déclare jamais de champ technique non importable (linkedArticleId, active, importLogId, siteId, createdAt, updatedAt)', () => {
    const keys = AROMA_SAMPLE_MAPPING_CONFIG.fields.map((field) => field.key);

    expect(keys).toEqual([
      'legacyId',
      'supplierNameRaw',
      'productName',
      'supplierReference',
      'category',
      'rating',
      'stockGrams',
      'pricePerKgEur',
      'addedAt',
      'comment',
    ]);
    expect(keys).not.toContain('linkedArticleId');
    expect(keys).not.toContain('active');
    expect(keys).not.toContain('importLogId');
    expect(keys).not.toContain('siteId');
    expect(keys).not.toContain('createdAt');
    expect(keys).not.toContain('updatedAt');
  });

  it('associe automatiquement les 10 en-têtes réels aux 10 champs attendus, sans correction manuelle', async () => {
    const result = await service.suggest(
      siteId,
      source,
      entityType,
      realHeaders,
      AROMA_SAMPLE_MAPPING_CONFIG,
    );

    const columnNameByFieldKey = Object.fromEntries(
      result.fields.map((field) => [field.fieldKey, field.columnName]),
    );

    expect(columnNameByFieldKey).toEqual({
      legacyId: 'EF-0378',
      supplierNameRaw: 'Fournisseur',
      productName: 'Produit / Arôme',
      supplierReference: 'Référence',
      category: 'Catégorie',
      rating: 'Note ★',
      stockGrams: 'Stock (g)',
      pricePerKgEur: 'Prix/kg (€)',
      addedAt: 'Date ajout',
      comment: 'Commentaire',
    });
  });

  it('considère le mapping complet avec les 10 en-têtes réels (aucun champ obligatoire manquant)', async () => {
    const result = await service.suggest(
      siteId,
      source,
      entityType,
      realHeaders,
      AROMA_SAMPLE_MAPPING_CONFIG,
    );

    expect(result.missingRequiredFields).toEqual([]);
    expect(result.ignoredColumns).toEqual([]);
  });

  it('associe "EF-0378" uniquement à legacyId, jamais à supplierReference', async () => {
    const result = await service.suggest(
      siteId,
      source,
      entityType,
      realHeaders,
      AROMA_SAMPLE_MAPPING_CONFIG,
    );

    const legacyId = result.fields.find((f) => f.fieldKey === 'legacyId');
    const supplierReference = result.fields.find(
      (f) => f.fieldKey === 'supplierReference',
    );

    expect(legacyId?.columnName).toBe('EF-0378');
    expect(supplierReference?.columnName).not.toBe('EF-0378');
  });

  it('associe "Référence" uniquement à supplierReference, jamais à legacyId', async () => {
    const result = await service.suggest(
      siteId,
      source,
      entityType,
      realHeaders,
      AROMA_SAMPLE_MAPPING_CONFIG,
    );

    const supplierReference = result.fields.find(
      (f) => f.fieldKey === 'supplierReference',
    );
    const legacyId = result.fields.find((f) => f.fieldKey === 'legacyId');

    expect(supplierReference?.columnName).toBe('Référence');
    expect(legacyId?.columnName).not.toBe('Référence');
  });

  it('ne rend obligatoires que legacyId, supplierNameRaw et productName : les autres en-têtes peuvent manquer sans bloquer', async () => {
    const minimalHeaders = ['EF-0378', 'Fournisseur', 'Produit / Arôme'];

    const result = await service.suggest(
      siteId,
      source,
      entityType,
      minimalHeaders,
      AROMA_SAMPLE_MAPPING_CONFIG,
    );

    expect(result.missingRequiredFields).toEqual([]);
  });

  it('reconnaît les synonymes sans accents les plus importants (Categorie, Arome, Reference, Date ajout)', async () => {
    const headersWithoutAccents = [
      'EF-0378',
      'Fournisseur',
      'Arome',
      'Reference',
      'Categorie',
      'Date ajout',
    ];

    const result = await service.suggest(
      siteId,
      source,
      entityType,
      headersWithoutAccents,
      AROMA_SAMPLE_MAPPING_CONFIG,
    );

    const columnNameByFieldKey = Object.fromEntries(
      result.fields.map((field) => [field.fieldKey, field.columnName]),
    );

    expect(columnNameByFieldKey.legacyId).toBe('EF-0378');
    expect(columnNameByFieldKey.supplierNameRaw).toBe('Fournisseur');
    expect(columnNameByFieldKey.productName).toBe('Arome');
    expect(columnNameByFieldKey.supplierReference).toBe('Reference');
    expect(columnNameByFieldKey.category).toBe('Categorie');
    expect(columnNameByFieldKey.addedAt).toBe('Date ajout');
    expect(result.missingRequiredFields).toEqual([]);
  });

  it('ne force aucune correspondance sur une colonne inconnue : elle reste ignorée', async () => {
    const headersWithUnknownColumn = [...realHeaders, 'Colonne mystère'];

    const result = await service.suggest(
      siteId,
      source,
      entityType,
      headersWithUnknownColumn,
      AROMA_SAMPLE_MAPPING_CONFIG,
    );

    expect(result.ignoredColumns).toEqual(['Colonne mystère']);
    expect(
      result.fields.some((field) => field.columnName === 'Colonne mystère'),
    ).toBe(false);
  });
});
