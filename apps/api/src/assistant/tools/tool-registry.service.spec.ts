import { ToolRegistryService } from './tool-registry.service';
import type { ToolDefinition } from './tool.types';

describe('ToolRegistryService', () => {
  let service: ToolRegistryService;

  const sampleTool: ToolDefinition = {
    name: 'sample.tool',
    description: 'Outil de test.',
    inputSchema: {},
    permission: { kind: 'authenticated' },
    category: 'read',
    handler: () => Promise.resolve({}),
  };

  beforeEach(() => {
    service = new ToolRegistryService();
  });

  it('est vide par défaut (AI-02 : aucun outil métier)', () => {
    expect(service.list()).toEqual([]);
  });

  it('enregistre un outil et le retrouve par son nom', () => {
    service.register(sampleTool);

    expect(service.get('sample.tool')).toBe(sampleTool);
    expect(service.list()).toEqual([sampleTool]);
  });

  it('refuse d’enregistrer deux outils portant le même nom', () => {
    service.register(sampleTool);

    expect(() => service.register(sampleTool)).toThrow(
      'Un outil nommé "sample.tool" est déjà enregistré.',
    );
  });

  it('renvoie undefined pour un nom inconnu', () => {
    expect(service.get('inconnu')).toBeUndefined();
  });
});
