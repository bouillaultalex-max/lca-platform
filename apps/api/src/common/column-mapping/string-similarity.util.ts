/**
 * Fonctions pures de comparaison de texte, utilisées par le moteur de mapping de colonnes.
 * Aucune connaissance métier ici : uniquement de la manipulation générique de chaînes.
 */

const COMBINING_DIACRITICAL_MARKS = /[̀-ͯ]/g;

/**
 * Normalise un texte pour comparaison : minuscules, accents supprimés, ponctuation
 * réduite à des espaces, espaces multiples compactés.
 */
export function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(COMBINING_DIACRITICAL_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Distance de Levenshtein (nombre minimal d'insertions/suppressions/substitutions
 * pour passer de `a` à `b`).
 */
export function levenshteinDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const distances: number[][] = Array.from({ length: rows }, () =>
    new Array<number>(cols).fill(0),
  );

  for (let i = 0; i < rows; i += 1) distances[i][0] = i;
  for (let j = 0; j < cols; j += 1) distances[0][j] = j;

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      distances[i][j] = Math.min(
        distances[i - 1][j] + 1,
        distances[i][j - 1] + 1,
        distances[i - 1][j - 1] + cost,
      );
    }
  }

  return distances[rows - 1][cols - 1];
}

/**
 * Similarité entre 0 (rien en commun) et 1 (identiques), dérivée de la distance de
 * Levenshtein rapportée à la longueur du plus long des deux textes.
 */
export function similarityRatio(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1;
  const maxLength = Math.max(a.length, b.length);
  if (maxLength === 0) return 1;
  return 1 - levenshteinDistance(a, b) / maxLength;
}
