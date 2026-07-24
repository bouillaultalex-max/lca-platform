import { buildDeterministicSummary } from './conversation-summary.util';
import type { AiMessage } from '../../../generated/prisma/client';

let idCounter = 0;
function buildMessage(overrides: Partial<AiMessage>): AiMessage {
  idCounter += 1;
  return {
    id: `msg-${idCounter}`,
    conversationId: 'conv-1',
    role: 'USER',
    content: '',
    toolName: null,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('buildDeterministicSummary', () => {
  it('compte correctement les messages utilisateur et assistant écartés', () => {
    const discarded = [
      buildMessage({ role: 'USER', content: 'Question 1 confidentielle' }),
      buildMessage({
        role: 'ASSISTANT',
        content: 'Réponse 1 avec des données',
      }),
      buildMessage({ role: 'USER', content: 'Question 2' }),
    ];

    const summary = buildDeterministicSummary(discarded);

    expect(summary).toContain('2 message(s) utilisateur');
    expect(summary).toContain('1 réponse(s) assistant');
  });

  it('liste les outils utilisés à partir des lignes TOOL_CALL, dédupliqués et triés', () => {
    const discarded = [
      buildMessage({ role: 'TOOL_CALL', toolName: 'stock.listLowStockItems' }),
      buildMessage({ role: 'TOOL_CALL', toolName: 'dashboard.getSummary' }),
      buildMessage({ role: 'TOOL_CALL', toolName: 'dashboard.getSummary' }),
    ];

    const summary = buildDeterministicSummary(discarded);
    const toolLines = summary
      .split('\n')
      .filter((line) => line.trim().startsWith('- ') && line.includes('.'));

    expect(toolLines).toEqual([
      '  - dashboard.getSummary',
      '  - stock.listLowStockItems',
    ]);
  });

  it("n'ajoute pas de section outils si aucune ligne TOOL_CALL n'est présente", () => {
    const discarded = [buildMessage({ role: 'USER', content: 'Salut' })];

    const summary = buildDeterministicSummary(discarded);

    expect(summary).not.toContain('outils utilisés');
  });

  it('ne contient jamais le contenu des messages (aucune donnée métier, aucun extrait)', () => {
    const discarded = [
      buildMessage({
        role: 'USER',
        content: 'Le lot 455123 contient un défaut critique confidentiel',
      }),
      buildMessage({
        role: 'ASSISTANT',
        content: 'Le stock de Flacon 100ml est à 12 unités',
      }),
    ];

    const summary = buildDeterministicSummary(discarded);

    expect(summary).not.toContain('455123');
    expect(summary).not.toContain('Flacon');
    expect(summary).not.toContain('confidentiel');
  });

  it('gère une liste vide sans erreur', () => {
    const summary = buildDeterministicSummary([]);

    expect(summary).toContain('0 message(s) utilisateur');
    expect(summary).toContain('0 réponse(s) assistant');
  });

  it('est déterministe (même entrée, même sortie)', () => {
    const discarded = [
      buildMessage({ role: 'USER' }),
      buildMessage({ role: 'TOOL_CALL', toolName: 'production.getBatch' }),
    ];

    expect(buildDeterministicSummary(discarded)).toBe(
      buildDeterministicSummary(discarded),
    );
  });
});
