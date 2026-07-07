import { parseDecimal, parseRequiredString } from './value-parsing.util';

describe('parseRequiredString', () => {
  it('renvoie la chaîne recadrée pour une chaîne non vide', () => {
    expect(parseRequiredString('  MP-1  ')).toBe('MP-1');
  });

  it('renvoie null pour une chaîne vide ou blanche', () => {
    expect(parseRequiredString('')).toBeNull();
    expect(parseRequiredString('   ')).toBeNull();
  });

  it('convertit un nombre en chaîne', () => {
    expect(parseRequiredString(12345)).toBe('12345');
  });

  it('renvoie null pour tout autre type', () => {
    expect(parseRequiredString(null)).toBeNull();
    expect(parseRequiredString(undefined)).toBeNull();
    expect(parseRequiredString(true)).toBeNull();
  });
});

describe('parseDecimal', () => {
  it('accepte un nombre tel quel', () => {
    expect(parseDecimal(12.5)).toBe(12.5);
    expect(parseDecimal(-3)).toBe(-3);
  });

  it('tolère la virgule décimale française', () => {
    expect(parseDecimal('9,90')).toBe(9.9);
  });

  it('accepte un point décimal', () => {
    expect(parseDecimal('9.90')).toBe(9.9);
  });

  it('renvoie null pour une chaîne vide ou non numérique', () => {
    expect(parseDecimal('')).toBeNull();
    expect(parseDecimal('abc')).toBeNull();
  });

  it('renvoie null pour tout autre type', () => {
    expect(parseDecimal(null)).toBeNull();
    expect(parseDecimal(undefined)).toBeNull();
  });
});
