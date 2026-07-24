/**
 * Tronque un texte pour ne jamais dépasser `maxChars` (AI-05), en ajoutant une
 * indication neutre et explicite de troncature — jamais un contenu inventé
 * pour remplacer ce qui a été retiré. La marque de troncature elle-même est
 * comptée dans `maxChars` : le résultat ne dépasse jamais la limite, marque
 * comprise.
 */
const TRUNCATION_MARKER = '\n[message tronqué]';

export interface TruncationResult {
  content: string;
  truncated: boolean;
  /** Nombre de caractères du texte d'origine qui n'ont pas été transmis. */
  truncatedChars: number;
}

export function truncateToMaxChars(
  content: string,
  maxChars: number,
): TruncationResult {
  if (content.length <= maxChars) {
    return { content, truncated: false, truncatedChars: 0 };
  }
  if (maxChars <= 0) {
    return { content: '', truncated: true, truncatedChars: content.length };
  }

  // Cas limite d'une configuration extrêmement stricte (maxChars plus petit
  // que la marque elle-même) : la marque est à son tour raccourcie, pour ne
  // jamais dépasser `maxChars` quelle que soit la configuration.
  const marker =
    TRUNCATION_MARKER.length <= maxChars
      ? TRUNCATION_MARKER
      : TRUNCATION_MARKER.slice(0, maxChars);
  const keepLength = Math.max(0, maxChars - marker.length);
  const truncatedChars = content.length - keepLength;
  return {
    content: content.slice(0, keepLength) + marker,
    truncated: true,
    truncatedChars,
  };
}
