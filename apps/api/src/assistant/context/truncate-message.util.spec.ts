import { truncateToMaxChars } from './truncate-message.util';

describe('truncateToMaxChars', () => {
  it('ne modifie pas un texte déjà sous la limite', () => {
    const result = truncateToMaxChars('bonjour', 100);
    expect(result).toEqual({
      content: 'bonjour',
      truncated: false,
      truncatedChars: 0,
    });
  });

  it('ne modifie pas un texte exactement à la limite', () => {
    const result = truncateToMaxChars('abcde', 5);
    expect(result.truncated).toBe(false);
  });

  it('tronque un texte dépassant la limite et ajoute une indication neutre', () => {
    const content = 'a'.repeat(200);
    const result = truncateToMaxChars(content, 50);

    expect(result.truncated).toBe(true);
    expect(result.content.length).toBeLessThanOrEqual(50);
    expect(result.content).toContain('tronqué');
    expect(result.content.startsWith('a')).toBe(true);
  });

  it('ne dépasse jamais maxChars, marque de troncature comprise', () => {
    const content = 'b'.repeat(1000);
    for (const limit of [10, 30, 60, 100]) {
      const result = truncateToMaxChars(content, limit);
      expect(result.content.length).toBeLessThanOrEqual(limit);
    }
  });

  it("n'invente jamais de contenu : le début tronqué est un préfixe exact de l'original", () => {
    const content =
      'Ceci est un message métier précis, à ne jamais reformuler.';
    const result = truncateToMaxChars(content, 20);

    const markerIndex = result.content.indexOf('\n[');
    const keptPrefix = result.content.slice(0, markerIndex);
    expect(content.startsWith(keptPrefix)).toBe(true);
  });

  it('rapporte le nombre exact de caractères non transmis', () => {
    const content = 'x'.repeat(100);
    const result = truncateToMaxChars(content, 60);

    expect(result.truncatedChars).toBeGreaterThan(0);
    expect(result.truncatedChars).toBeLessThan(100);
  });

  it('est déterministe (même entrée, même sortie)', () => {
    const content = 'z'.repeat(500);
    expect(truncateToMaxChars(content, 40)).toEqual(
      truncateToMaxChars(content, 40),
    );
  });
});
