import { parseStrictSafeInteger } from './lot-number-conversion.util';
import { LotNumberConversionError } from './lot-number-generator.errors';

describe('parseStrictSafeInteger', () => {
  it('accepte une chaîne strictement numérique et retourne l’entier exact', () => {
    expect(parseStrictSafeInteger('456148')).toBe(456148);
  });

  it('accepte un number déjà sûr', () => {
    expect(parseStrictSafeInteger(456148)).toBe(456148);
  });

  it('rejette null', () => {
    expect(() => parseStrictSafeInteger(null)).toThrow(LotNumberConversionError);
  });

  it('rejette undefined', () => {
    expect(() => parseStrictSafeInteger(undefined)).toThrow(
      LotNumberConversionError,
    );
  });

  it('rejette la chaîne vide', () => {
    expect(() => parseStrictSafeInteger('')).toThrow(LotNumberConversionError);
  });

  it('rejette une valeur non numérique', () => {
    expect(() => parseStrictSafeInteger('abc')).toThrow(
      LotNumberConversionError,
    );
    expect(() => parseStrictSafeInteger('45a148')).toThrow(
      LotNumberConversionError,
    );
  });

  it('rejette une décimale', () => {
    expect(() => parseStrictSafeInteger('456148.5')).toThrow(
      LotNumberConversionError,
    );
  });

  it('rejette les espaces (tête, fin, internes)', () => {
    expect(() => parseStrictSafeInteger(' 456148')).toThrow(
      LotNumberConversionError,
    );
    expect(() => parseStrictSafeInteger('456148 ')).toThrow(
      LotNumberConversionError,
    );
    expect(() => parseStrictSafeInteger('456 148')).toThrow(
      LotNumberConversionError,
    );
  });

  it('rejette un signe explicite', () => {
    expect(() => parseStrictSafeInteger('+456148')).toThrow(
      LotNumberConversionError,
    );
    expect(() => parseStrictSafeInteger('-456148')).toThrow(
      LotNumberConversionError,
    );
  });

  it('rejette la notation scientifique', () => {
    expect(() => parseStrictSafeInteger('4.56148e5')).toThrow(
      LotNumberConversionError,
    );
  });

  it('rejette une chaîne dépassant Number.MAX_SAFE_INTEGER', () => {
    expect(() => parseStrictSafeInteger('99999999999999999')).toThrow(
      LotNumberConversionError,
    );
  });

  it('rejette un number dépassant Number.MAX_SAFE_INTEGER', () => {
    expect(() =>
      parseStrictSafeInteger(Number.MAX_SAFE_INTEGER + 2),
    ).toThrow(LotNumberConversionError);
  });

  it('accepte Number.MAX_SAFE_INTEGER lui-même', () => {
    expect(parseStrictSafeInteger(Number.MAX_SAFE_INTEGER)).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });

  it('rejette un type inattendu (objet, booléen)', () => {
    expect(() => parseStrictSafeInteger({})).toThrow(LotNumberConversionError);
    expect(() => parseStrictSafeInteger(true)).toThrow(
      LotNumberConversionError,
    );
  });

  it('ne produit jamais NaN ni 0 en cas d’échec : l’appel lève systématiquement', () => {
    const invalidInputs = [
      null,
      undefined,
      '',
      'abc',
      '456148.5',
      ' 456148',
      '+456148',
      '99999999999999999',
    ];
    for (const input of invalidInputs) {
      expect(() => parseStrictSafeInteger(input)).toThrow();
    }
  });
});
