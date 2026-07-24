import { OpenAiToolCallAccumulator } from './openai-tool-call-accumulator';

describe('OpenAiToolCallAccumulator', () => {
  it('accumule un tool call reçu en un seul fragment', () => {
    const accumulator = new OpenAiToolCallAccumulator();
    accumulator.addDelta({
      index: 0,
      id: 'call-1',
      function: { name: 'dashboard_getSummary', arguments: '{}' },
    });

    expect(accumulator.finalize()).toEqual([
      { id: 'call-1', name: 'dashboard_getSummary', input: {} },
    ]);
  });

  it('accumule des arguments fragmentés sur plusieurs deltas', () => {
    const accumulator = new OpenAiToolCallAccumulator();
    accumulator.addDelta({
      index: 0,
      id: 'call-1',
      function: { name: 'stock_getArticleAvailability' },
    });
    accumulator.addDelta({ index: 0, function: { arguments: '{"query":' } });
    accumulator.addDelta({ index: 0, function: { arguments: '"flacon"}' } });

    expect(accumulator.finalize()).toEqual([
      {
        id: 'call-1',
        name: 'stock_getArticleAvailability',
        input: { query: 'flacon' },
      },
    ]);
  });

  it('accumule plusieurs tool calls distincts par index, dans l’ordre', () => {
    const accumulator = new OpenAiToolCallAccumulator();
    accumulator.addDelta({
      index: 1,
      id: 'call-2',
      function: { name: 'stock_listLowStockItems', arguments: '{}' },
    });
    accumulator.addDelta({
      index: 0,
      id: 'call-1',
      function: { name: 'dashboard_getSummary', arguments: '{}' },
    });

    expect(accumulator.finalize()).toEqual([
      { id: 'call-1', name: 'dashboard_getSummary', input: {} },
      { id: 'call-2', name: 'stock_listLowStockItems', input: {} },
    ]);
  });

  it('gère un nom de fonction reçu en plusieurs fragments', () => {
    const accumulator = new OpenAiToolCallAccumulator();
    accumulator.addDelta({
      index: 0,
      id: 'call-1',
      function: { name: 'dash' },
    });
    accumulator.addDelta({
      index: 0,
      function: { name: 'board_getSummary', arguments: '{}' },
    });

    expect(accumulator.finalize()).toEqual([
      { id: 'call-1', name: 'dashboard_getSummary', input: {} },
    ]);
  });

  it("lève une erreur si l'identifiant n'a jamais été reçu", () => {
    const accumulator = new OpenAiToolCallAccumulator();
    accumulator.addDelta({
      index: 0,
      function: { name: 'dashboard_getSummary', arguments: '{}' },
    });

    expect(() => accumulator.finalize()).toThrow(/incomplet/);
  });

  it("lève une erreur si le nom n'a jamais été reçu", () => {
    const accumulator = new OpenAiToolCallAccumulator();
    accumulator.addDelta({
      index: 0,
      id: 'call-1',
      function: { arguments: '{}' },
    });

    expect(() => accumulator.finalize()).toThrow(/incomplet/);
  });

  it('lève une erreur si les arguments accumulés ne forment pas un JSON valide', () => {
    const accumulator = new OpenAiToolCallAccumulator();
    accumulator.addDelta({
      index: 0,
      id: 'call-1',
      function: { name: 'dashboard_getSummary', arguments: '{invalide' },
    });

    expect(() => accumulator.finalize()).toThrow(/invalides/);
  });

  it("n'invente jamais de valeur par défaut pour des arguments absents autre qu'un objet vide", () => {
    const accumulator = new OpenAiToolCallAccumulator();
    accumulator.addDelta({
      index: 0,
      id: 'call-1',
      function: { name: 'dashboard_getSummary' },
    });

    expect(accumulator.finalize()).toEqual([
      { id: 'call-1', name: 'dashboard_getSummary', input: {} },
    ]);
  });
});
