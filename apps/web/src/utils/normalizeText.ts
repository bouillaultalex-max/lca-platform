/** Retire les accents et harmonise la casse, pour une comparaison insensible aux deux. */
export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}
