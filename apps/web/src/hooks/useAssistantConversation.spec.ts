import { describe, expect, it } from 'vitest';
import type { AssistantMessage } from '@lca-mes/shared';
import { accumulateAssistantChunk } from './useAssistantConversation';

describe('accumulateAssistantChunk', () => {
  it('crée le message ASSISTANT au premier chunk', () => {
    const result = accumulateAssistantChunk([], 'assistant-1', 'Bonjour ', '2026-07-30T10:00:00.000Z', true);

    expect(result).toEqual([
      { id: 'assistant-1', role: 'ASSISTANT', content: 'Bonjour ', createdAt: '2026-07-30T10:00:00.000Z' },
    ]);
  });

  it('produit un résultat identique appelée deux fois avec le même prev (StrictMode)', () => {
    const prev: AssistantMessage[] = [];

    const first = accumulateAssistantChunk(prev, 'assistant-1', 'Bonjour ', '2026-07-30T10:00:00.000Z', true);
    const second = accumulateAssistantChunk(prev, 'assistant-1', 'Bonjour ', '2026-07-30T10:00:00.000Z', true);

    expect(second).toEqual(first);
  });

  it('accumule les chunks suivants sur le même message sans dupliquer de bulle', () => {
    const prev: AssistantMessage[] = [
      { id: 'assistant-1', role: 'ASSISTANT', content: 'Bonjour ', createdAt: '2026-07-30T10:00:00.000Z' },
    ];

    const result = accumulateAssistantChunk(prev, 'assistant-1', 'le monde', '2026-07-30T10:00:00.100Z', false);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: 'assistant-1',
      role: 'ASSISTANT',
      content: 'Bonjour le monde',
      createdAt: '2026-07-30T10:00:00.000Z',
    });
  });

  it('conserve le message utilisateur existant sans le muter', () => {
    const userMessage: AssistantMessage = {
      id: 'user-1',
      role: 'USER',
      content: 'Test affichage',
      createdAt: '2026-07-30T09:59:59.000Z',
    };
    const prev: AssistantMessage[] = [
      userMessage,
      { id: 'assistant-1', role: 'ASSISTANT', content: 'Bonjour ', createdAt: '2026-07-30T10:00:00.000Z' },
    ];

    const result = accumulateAssistantChunk(prev, 'assistant-1', 'le monde', '2026-07-30T10:00:00.100Z', false);

    expect(result).toHaveLength(2);
    expect(result[0]).toBe(userMessage);
    expect(result[1].content).toBe('Bonjour le monde');
  });
});
