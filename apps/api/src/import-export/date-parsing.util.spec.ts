import { parseDateToIso } from './date-parsing.util';

describe('parseDateToIso', () => {
  it('accepte un numéro de série Excel', () => {
    expect(parseDateToIso(46209)).toBe('2026-07-06');
  });

  it('accepte une date ISO (AAAA-MM-JJ)', () => {
    expect(parseDateToIso('2026-07-06')).toBe('2026-07-06');
  });

  it('accepte une date française (JJ/MM/AAAA) et la convertit en ISO', () => {
    expect(parseDateToIso('06/07/2026')).toBe('2026-07-06');
  });

  it('accepte le 29 février sur une année bissextile', () => {
    expect(parseDateToIso('2028-02-29')).toBe('2028-02-29');
  });

  it('rejette une date française invalide (31 février)', () => {
    expect(parseDateToIso('31/02/2026')).toBeNull();
  });

  it('rejette le 29 février sur une année non bissextile', () => {
    expect(parseDateToIso('2026-02-29')).toBeNull();
  });

  it('rejette une chaîne qui ne correspond à aucun format', () => {
    expect(parseDateToIso('6 juillet 2026')).toBeNull();
    expect(parseDateToIso('')).toBeNull();
  });

  it('rejette tout autre type', () => {
    expect(parseDateToIso(null)).toBeNull();
    expect(parseDateToIso(undefined)).toBeNull();
    expect(parseDateToIso(true)).toBeNull();
  });
});
