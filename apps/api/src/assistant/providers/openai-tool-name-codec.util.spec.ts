import { buildOpenAiToolNameCodec } from './openai-tool-name-codec.util';
import type { AiToolSpec } from './ai-tool-spec';

function buildTool(name: string): AiToolSpec {
  return {
    name,
    description: 'Description.',
    inputSchema: { type: 'object', properties: {} },
  };
}

describe('buildOpenAiToolNameCodec', () => {
  it('remplace les points par des underscores pour respecter la contrainte OpenAI', () => {
    const codec = buildOpenAiToolNameCodec([buildTool('dashboard.getSummary')]);

    expect(codec.toOpenAiName('dashboard.getSummary')).toBe(
      'dashboard_getSummary',
    );
  });

  it('retrouve le nom interne à partir du nom OpenAI correspondant', () => {
    const codec = buildOpenAiToolNameCodec([
      buildTool('stock.getArticleAvailability'),
    ]);

    const openAiName = codec.toOpenAiName('stock.getArticleAvailability');
    expect(codec.toInternalName(openAiName)).toBe(
      'stock.getArticleAvailability',
    );
  });

  it('gère les 6 outils réels sans collision', () => {
    const tools = [
      'dashboard.getSummary',
      'stock.getArticleAvailability',
      'stock.listLowStockItems',
      'traceability.getLotByNumber',
      'production.getBatch',
      'imports.getImportHistory',
    ].map(buildTool);
    const codec = buildOpenAiToolNameCodec(tools);

    const openAiNames = tools.map((t) => codec.toOpenAiName(t.name));
    expect(new Set(openAiNames).size).toBe(6);
    for (const tool of tools) {
      expect(codec.toInternalName(codec.toOpenAiName(tool.name))).toBe(
        tool.name,
      );
    }
  });

  it("renvoie le nom reçu tel quel, sans jamais deviner ni corriger, si aucune correspondance n'existe (outil inconnu/halluciné)", () => {
    const codec = buildOpenAiToolNameCodec([buildTool('dashboard.getSummary')]);

    expect(codec.toInternalName('outil_inconnu')).toBe('outil_inconnu');
  });

  it('lève une erreur explicite en cas de collision de noms après normalisation', () => {
    expect(() =>
      buildOpenAiToolNameCodec([buildTool('a.b'), buildTool('a_b')]),
    ).toThrow(/Collision de nom d'outil/);
  });

  it('tronque un nom dépassant 64 caractères (contrainte OpenAI)', () => {
    const longName = 'a'.repeat(100);
    const codec = buildOpenAiToolNameCodec([buildTool(longName)]);

    expect(codec.toOpenAiName(longName).length).toBeLessThanOrEqual(64);
  });
});
