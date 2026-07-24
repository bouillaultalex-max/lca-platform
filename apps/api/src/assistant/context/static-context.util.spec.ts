import { buildStaticContext } from './static-context.util';
import type { Clock } from './clock';

function fixedClock(iso: string): Clock {
  return { now: () => new Date(iso) };
}

describe('buildStaticContext', () => {
  it('est déterministe pour une horloge fixée (aucune dépendance à l’heure réelle)', () => {
    const clock = fixedClock('2026-07-24T10:42:00.000Z');
    expect(buildStaticContext(clock)).toBe(buildStaticContext(clock));
  });

  it('inclut la date, l’heure, la langue, le fuseau horaire et la version applicative', () => {
    const clock = fixedClock('2026-07-24T10:42:00.000Z');
    const context = buildStaticContext(clock);

    expect(context).toContain('Date :');
    expect(context).toContain('Heure :');
    expect(context).toContain('Langue : fr-FR');
    expect(context).toContain('Fuseau horaire : Europe/Paris');
    expect(context).toMatch(/Version de l'application : \d+\.\d+\.\d+/);
  });

  it('ne contient jamais de donnée métier (aucune mention d’article, lot, batch, stock, site)', () => {
    const clock = fixedClock('2026-07-24T10:42:00.000Z');
    const context = buildStaticContext(clock).toLowerCase();

    for (const forbidden of [
      'article',
      'lot',
      'batch',
      'stock',
      'site',
      'utilisateur',
    ]) {
      expect(context).not.toContain(forbidden);
    }
  });

  it('varie si l’horloge injectée renvoie une date différente', () => {
    const contextA = buildStaticContext(fixedClock('2026-01-01T00:00:00.000Z'));
    const contextB = buildStaticContext(fixedClock('2026-12-31T23:59:00.000Z'));

    expect(contextA).not.toBe(contextB);
  });
});
