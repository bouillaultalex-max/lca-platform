import { describe, expect, it } from 'vitest';
import { normalizeText } from './normalizeText';

describe('normalizeText', () => {
  it('retire les accents', () => {
    expect(normalizeText('Décoction de thé vert')).toBe('decoction de the vert');
  });

  it('met en minuscules', () => {
    expect(normalizeText('MATIERE PREMIERE')).toBe('matiere premiere');
  });

  it('laisse intact un texte déjà normalisé', () => {
    expect(normalizeText('lavande')).toBe('lavande');
  });
});
