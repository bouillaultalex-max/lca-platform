import {
  ColumnMappingService,
  DEFAULT_SOURCE_VERSION,
} from './column-mapping.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MappingConfig, SourceRow } from './column-mapping.types';

describe('ColumnMappingService', () => {
  let service: ColumnMappingService;
  let prisma: {
    columnMappingRule: {
      findMany: jest.Mock<Promise<unknown>, [Record<string, unknown>]>;
      upsert: jest.Mock<Promise<unknown>, [Record<string, unknown>]>;
    };
  };

  const siteId = 'site-1';
  const source = 'OPENSI';
  const entityType = 'ARTICLES';

  const testConfig: MappingConfig = {
    fields: [
      {
        key: 'reference',
        label: 'Référence',
        required: true,
        type: 'string',
        synonyms: ['Référence', 'Réf.', 'SKU', 'Code article'],
      },
      {
        key: 'designation',
        label: 'Désignation',
        required: true,
        type: 'string',
        synonyms: ['Désignation', 'Nom', 'Libellé', 'Produit'],
      },
      {
        key: 'price',
        label: 'Prix',
        required: false,
        type: 'number',
        synonyms: ['Prix', 'Coût', 'PA'],
      },
    ],
  };

  beforeEach(() => {
    prisma = {
      columnMappingRule: {
        findMany: jest.fn<Promise<unknown>, [Record<string, unknown>]>(),
        upsert: jest.fn<Promise<unknown>, [Record<string, unknown>]>(),
      },
    };
    prisma.columnMappingRule.findMany.mockResolvedValue([]);
    service = new ColumnMappingService(prisma as unknown as PrismaService);
  });

  describe('suggest', () => {
    it('reconnaît les correspondances exactes, partielles et floues, et ignore le reste', async () => {
      const headers = [
        'Réf.',
        'Désignation',
        'Prix achat',
        'Commentaire libre',
      ];

      const result = await service.suggest(
        siteId,
        source,
        entityType,
        headers,
        testConfig,
      );

      const reference = result.fields.find((f) => f.fieldKey === 'reference');
      expect(reference).toMatchObject({ columnName: 'Réf.', confidence: 100 });
      expect(reference?.reason).toContain('exacte');

      const designation = result.fields.find(
        (f) => f.fieldKey === 'designation',
      );
      expect(designation).toMatchObject({
        columnName: 'Désignation',
        confidence: 100,
      });

      const price = result.fields.find((f) => f.fieldKey === 'price');
      expect(price?.columnName).toBe('Prix achat');
      expect(price?.confidence).toBeGreaterThanOrEqual(50);
      expect(price?.reason).toContain('contient');

      expect(result.ignoredColumns).toEqual(['Commentaire libre']);
      expect(result.missingRequiredFields).toEqual([]);
      expect(result.hints).toEqual([]);
    });

    it("signale un champ obligatoire manquant sans piste quand rien n'y ressemble", async () => {
      const minimalConfig: MappingConfig = {
        fields: [testConfig.fields[0]],
      };
      const headers = ['Observation'];

      const result = await service.suggest(
        siteId,
        source,
        entityType,
        headers,
        minimalConfig,
      );

      expect(result.missingRequiredFields).toEqual(['reference']);
      expect(result.hints).toEqual([]);
      expect(result.ignoredColumns).toEqual(['Observation']);
    });

    it('propose une piste faible pour un champ obligatoire manquant, sans la lister automatiquement', async () => {
      const designationOnlyConfig: MappingConfig = {
        fields: [testConfig.fields[1]], // designation
      };
      const headers = ['Appellation'];

      const result = await service.suggest(
        siteId,
        source,
        entityType,
        headers,
        designationOnlyConfig,
      );

      expect(result.missingRequiredFields).toEqual(['designation']);
      expect(result.fields[0].columnName).toBeNull();
      expect(result.hints).toEqual([
        expect.objectContaining({
          fieldKey: 'designation',
          suggestedColumnName: 'Appellation',
        }),
      ]);
      expect(result.hints[0].message).toContain('Appellation');
      // La colonne reste dans les colonnes ignorées : la piste n'est qu'une suggestion.
      expect(result.ignoredColumns).toEqual(['Appellation']);
    });

    it('attribue la colonne au champ le mieux noté en cas de conflit, sans piste pour le perdant', async () => {
      const conflictConfig: MappingConfig = {
        fields: [
          {
            key: 'strong',
            label: 'Champ fort',
            required: true,
            type: 'string',
            synonyms: ['Code'],
          },
          {
            key: 'weak',
            label: 'Champ faible',
            required: true,
            type: 'string',
            synonyms: ['Code exact'],
          },
        ],
      };
      const headers = ['Code'];

      const result = await service.suggest(
        siteId,
        source,
        entityType,
        headers,
        conflictConfig,
      );

      const strong = result.fields.find((f) => f.fieldKey === 'strong');
      const weak = result.fields.find((f) => f.fieldKey === 'weak');
      expect(strong?.columnName).toBe('Code');
      expect(strong?.confidence).toBe(100);
      expect(weak?.columnName).toBeNull();
      expect(result.missingRequiredFields).toEqual(['weak']);
      expect(result.hints).toEqual([]);
    });

    it('donne priorité à une règle apprise sur le calcul par synonymes', async () => {
      prisma.columnMappingRule.findMany.mockResolvedValue([
        {
          id: 'rule-1',
          siteId,
          source,
          sourceVersion: DEFAULT_SOURCE_VERSION,
          entityType,
          columnNameNormalized: 'prix achat',
          columnNameOriginal: 'Prix achat',
          fieldKey: 'reference',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const result = await service.suggest(
        siteId,
        source,
        entityType,
        ['Prix achat'],
        testConfig,
      );

      const reference = result.fields.find((f) => f.fieldKey === 'reference');
      expect(reference).toMatchObject({
        columnName: 'Prix achat',
        confidence: 100,
      });
      expect(reference?.reason).toContain('Mémorisé');
      // Sans sourceVersion explicite, le service interroge la version par défaut.
      expect(prisma.columnMappingRule.findMany).toHaveBeenCalledWith({
        where: {
          siteId,
          source,
          sourceVersion: DEFAULT_SOURCE_VERSION,
          entityType,
        },
      });
    });

    it('interroge la sourceVersion explicitement fournie plutôt que la valeur par défaut', async () => {
      await service.suggest(
        siteId,
        source,
        entityType,
        ['Réf.'],
        testConfig,
        '2026.1',
      );

      expect(prisma.columnMappingRule.findMany).toHaveBeenCalledWith({
        where: { siteId, source, sourceVersion: '2026.1', entityType },
      });
    });

    it("n'applique pas une règle apprise sous une autre sourceVersion (isolation par version)", async () => {
      // Le mock simule le comportement réel de Prisma : findMany est filtré par
      // sourceVersion, donc une règle apprise sous "2025.1" n'est jamais retournée
      // lors d'un appel sur la version par défaut.
      prisma.columnMappingRule.findMany.mockImplementation(
        (args: { where: { sourceVersion: string } }) =>
          Promise.resolve(
            args.where.sourceVersion === '2025.1'
              ? [
                  {
                    id: 'rule-1',
                    siteId,
                    source,
                    sourceVersion: '2025.1',
                    entityType,
                    columnNameNormalized: 'ref',
                    columnNameOriginal: 'Réf.',
                    fieldKey: 'price',
                    createdAt: new Date(),
                    updatedAt: new Date(),
                  },
                ]
              : [],
          ),
      );

      const result = await service.suggest(
        siteId,
        source,
        entityType,
        ['Réf.'],
        testConfig,
      );

      // Sans la règle apprise sous "2025.1", "Réf." retrouve son affectation par
      // synonyme normale (reference), pas celle apprise sous l'ancienne version (price).
      const reference = result.fields.find((f) => f.fieldKey === 'reference');
      expect(reference?.columnName).toBe('Réf.');
      const price = result.fields.find((f) => f.fieldKey === 'price');
      expect(price?.columnName).toBeNull();
    });
  });

  describe('resolve', () => {
    it('applique une correction manuelle et recalcule les champs dérivés', async () => {
      const headers = ['Appellation'];
      const base = await service.suggest(siteId, source, entityType, headers, {
        fields: [testConfig.fields[1]],
      });
      expect(base.missingRequiredFields).toEqual(['designation']);

      const resolved = service.resolve(
        headers,
        { fields: [testConfig.fields[1]] },
        base,
        [{ fieldKey: 'designation', columnName: 'Appellation' }],
      );

      expect(resolved.fields[0]).toMatchObject({
        columnName: 'Appellation',
        confidence: 100,
        reason: 'Correspondance corrigée manuellement.',
      });
      expect(resolved.missingRequiredFields).toEqual([]);
      expect(resolved.ignoredColumns).toEqual([]);
      expect(resolved.hints).toEqual([]);
    });
  });

  describe('applyToRows', () => {
    it('projette les lignes vers les clés de champ, sans coercition', async () => {
      const headers = ['Réf.', 'Désignation'];
      const suggestion = await service.suggest(
        siteId,
        source,
        entityType,
        headers,
        {
          fields: [
            testConfig.fields[0],
            testConfig.fields[1],
            testConfig.fields[2],
          ],
        },
      );

      const rows: SourceRow[] = [
        { line: 2, data: { 'Réf.': 'ART-1', Désignation: 'Article un' } },
      ];

      const mapped = service.applyToRows(rows, suggestion);

      expect(mapped).toEqual([
        {
          line: 2,
          values: { reference: 'ART-1', designation: 'Article un' },
        },
      ]);
      expect(mapped[0].values).not.toHaveProperty('price');
    });
  });

  describe('learnFromCorrections', () => {
    it('enregistre chaque correction via un upsert normalisé, sous la version par défaut', async () => {
      prisma.columnMappingRule.upsert.mockResolvedValue({});

      await service.learnFromCorrections(siteId, source, entityType, [
        { fieldKey: 'designation', columnName: 'Appellation' },
      ]);

      expect(prisma.columnMappingRule.upsert).toHaveBeenCalledWith({
        where: {
          siteId_source_sourceVersion_entityType_columnNameNormalized: {
            siteId,
            source,
            sourceVersion: DEFAULT_SOURCE_VERSION,
            entityType,
            columnNameNormalized: 'appellation',
          },
        },
        update: { fieldKey: 'designation', columnNameOriginal: 'Appellation' },
        create: {
          siteId,
          source,
          sourceVersion: DEFAULT_SOURCE_VERSION,
          entityType,
          columnNameNormalized: 'appellation',
          columnNameOriginal: 'Appellation',
          fieldKey: 'designation',
        },
      });
    });

    it('enregistre la correction sous la sourceVersion explicitement fournie', async () => {
      prisma.columnMappingRule.upsert.mockResolvedValue({});

      await service.learnFromCorrections(
        siteId,
        source,
        entityType,
        [{ fieldKey: 'designation', columnName: 'Appellation' }],
        '2026.1',
      );

      expect(prisma.columnMappingRule.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            siteId_source_sourceVersion_entityType_columnNameNormalized: {
              siteId,
              source,
              sourceVersion: '2026.1',
              entityType,
              columnNameNormalized: 'appellation',
            },
          },
        }),
      );
    });
  });
});
