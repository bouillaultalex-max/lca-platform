import { computeReservedExpiryDate } from './reserved-expiry-date.util';

describe('computeReservedExpiryDate', () => {
  it('ajoute exactement 3 ans calendaires à une date ordinaire', () => {
    const startedAt = new Date('2026-08-24T10:15:00.000Z');
    const expiry = computeReservedExpiryDate(startedAt);

    expect(expiry.toISOString()).toBe('2029-08-24T10:15:00.000Z');
  });

  it('bascule au 1er mars pour un lancement le 29 février (année bissextile → non bissextile)', () => {
    const startedAt = new Date('2028-02-29T12:00:00.000Z');
    const expiry = computeReservedExpiryDate(startedAt);

    // 2031 n'est pas bissextile : Date.setFullYear normalise 29 février en 1er mars.
    expect(expiry.getUTCFullYear()).toBe(2031);
    expect(expiry.getUTCMonth()).toBe(2); // mars (0-indexé)
    expect(expiry.getUTCDate()).toBe(1);
  });

  it('ne modifie jamais la date de lancement passée en argument', () => {
    const startedAt = new Date('2026-08-24T10:15:00.000Z');
    const originalTime = startedAt.getTime();

    computeReservedExpiryDate(startedAt);

    expect(startedAt.getTime()).toBe(originalTime);
  });
});
