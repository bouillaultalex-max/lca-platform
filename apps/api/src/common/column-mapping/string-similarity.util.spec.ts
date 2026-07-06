import {
  levenshteinDistance,
  normalizeText,
  similarityRatio,
} from './string-similarity.util';

describe('normalizeText', () => {
  it('met en minuscules et supprime les accents', () => {
    expect(normalizeText('Référence')).toBe('reference');
    expect(normalizeText('Désignation')).toBe('designation');
  });

  it('réduit la ponctuation à des espaces et compacte les espaces multiples', () => {
    expect(normalizeText('Réf.')).toBe('ref');
    expect(normalizeText('Code   OpenSi')).toBe('code opensi');
    expect(normalizeText("Prix d'achat")).toBe('prix d achat');
  });

  it('retire les espaces de tête et de fin', () => {
    expect(normalizeText('  Prix  ')).toBe('prix');
  });
});

describe('levenshteinDistance', () => {
  it('vaut 0 pour deux chaînes identiques', () => {
    expect(levenshteinDistance('designation', 'designation')).toBe(0);
  });

  it("compte le nombre minimal d'opérations", () => {
    expect(levenshteinDistance('designation', 'desginations')).toBe(3);
    expect(levenshteinDistance('chat', 'chien')).toBeGreaterThan(0);
  });
});

describe('similarityRatio', () => {
  it('vaut 1 pour deux chaînes identiques (y compris vides)', () => {
    expect(similarityRatio('reference', 'reference')).toBe(1);
    expect(similarityRatio('', '')).toBe(1);
  });

  it('vaut 0 quand rien ne correspond à taille égale', () => {
    expect(similarityRatio('abc', 'xyz')).toBe(0);
  });

  it('retourne un score élevé pour une faute de frappe légère', () => {
    expect(similarityRatio('designation', 'desginations')).toBeGreaterThan(0.7);
  });
});
