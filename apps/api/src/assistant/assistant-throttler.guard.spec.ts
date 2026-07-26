import { resolveAssistantThrottleTracker } from './assistant-throttler.guard';

describe('resolveAssistantThrottleTracker', () => {
  it("utilise l'identifiant de l'utilisateur authentifié comme tracker", () => {
    const tracker = resolveAssistantThrottleTracker({
      user: { id: 'user-1' },
      ip: '203.0.113.10',
    });

    expect(tracker).toBe('user-1');
  });

  it("retombe sur l'adresse IP quand aucun utilisateur n'est présent", () => {
    const tracker = resolveAssistantThrottleTracker({ ip: '203.0.113.10' });

    expect(tracker).toBe('203.0.113.10');
  });

  it("ne lève jamais d'exception quand `user` est absent, même sans IP", () => {
    expect(() => resolveAssistantThrottleTracker({})).not.toThrow();
    expect(resolveAssistantThrottleTracker({})).toBe('');
  });
});
