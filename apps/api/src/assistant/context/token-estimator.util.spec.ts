import { estimateTokens } from './token-estimator.util';

describe('estimateTokens', () => {
  it('renvoie 0 pour une chaîne vide', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('estime environ 1 jeton pour 4 caractères', () => {
    expect(estimateTokens('abcd')).toBe(1);
  });

  it('arrondit au jeton supérieur', () => {
    expect(estimateTokens('abcde')).toBe(2);
  });

  it('applique un minimum d’un jeton pour tout texte non vide, même très court', () => {
    expect(estimateTokens('a')).toBe(1);
  });

  it('est déterministe (même entrée, même sortie)', () => {
    const text = 'Un texte de test répété plusieurs fois.';
    expect(estimateTokens(text)).toBe(estimateTokens(text));
  });

  it('croît avec la longueur du texte', () => {
    const short = estimateTokens('a'.repeat(10));
    const long = estimateTokens('a'.repeat(1000));
    expect(long).toBeGreaterThan(short);
  });
});
