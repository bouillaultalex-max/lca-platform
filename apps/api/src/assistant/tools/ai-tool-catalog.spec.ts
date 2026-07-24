import { buildAiToolCatalog } from './ai-tool-catalog';
import type { ToolDefinition } from './tool.types';

function buildTool(name: string, description = 'Description.'): ToolDefinition {
  return {
    name,
    description,
    inputSchema: undefined,
    permission: { kind: 'authenticated' },
    category: 'read',
    handler: jest.fn(),
  };
}

describe('buildAiToolCatalog', () => {
  it('traduit chacun des 6 outils validés en AI-03 vers un AiToolSpec avec un schéma JSON', () => {
    const tools = [
      buildTool('dashboard.getSummary'),
      buildTool('stock.getArticleAvailability'),
      buildTool('stock.listLowStockItems'),
      buildTool('traceability.getLotByNumber'),
      buildTool('production.getBatch'),
      buildTool('imports.getImportHistory'),
    ];

    const catalog = buildAiToolCatalog(tools);

    expect(catalog).toHaveLength(6);
    for (const spec of catalog) {
      expect(spec.inputSchema).toEqual(
        expect.objectContaining({ type: 'object' }),
      );
    }
  });

  it('ne transmet jamais handler ni permission au format AiToolSpec', () => {
    const tool = buildTool('dashboard.getSummary');
    const [spec] = buildAiToolCatalog([tool]);

    expect(spec).toEqual({
      name: 'dashboard.getSummary',
      description: 'Description.',
      inputSchema: { type: 'object', properties: {} },
    });
    expect(spec).not.toHaveProperty('handler');
    expect(spec).not.toHaveProperty('permission');
  });

  it('déclare correctement les paramètres requis pour un outil avec entrée obligatoire', () => {
    const [spec] = buildAiToolCatalog([
      buildTool('stock.getArticleAvailability'),
    ]);

    expect(spec.inputSchema.type).toBe('object');
    expect(spec.inputSchema.required).toEqual(['query']);
    expect(spec.inputSchema.properties.query).toEqual(
      expect.objectContaining({ type: 'string', minLength: 1 }),
    );
  });

  it('déclare un paramètre optionnel (imports.getImportHistory.limit) sans le lister en required', () => {
    const [spec] = buildAiToolCatalog([buildTool('imports.getImportHistory')]);

    expect(spec.inputSchema.required).toBeUndefined();
    expect(spec.inputSchema.properties.limit).toEqual(
      expect.objectContaining({ type: 'integer', minimum: 1, maximum: 50 }),
    );
  });

  it("lève une erreur explicite si un outil enregistré n'a pas de schéma déclaré", () => {
    expect(() => buildAiToolCatalog([buildTool('outil.inconnu')])).toThrow(
      /Aucun schéma JSON déclaré/,
    );
  });
});
