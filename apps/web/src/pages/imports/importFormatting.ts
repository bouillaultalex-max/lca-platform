import type { FieldMappingResult } from '@lca-mes/shared';

/**
 * Formate une date d'import en langage naturel ("Aujourd'hui à 14h32", "Hier à...",
 * sinon une date complète) — jamais un horodatage technique brut.
 */
export function formatImportDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();

  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  const time = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }).replace(':', 'h');

  if (isSameDay(date, now)) {
    return `Aujourd'hui à ${time}`;
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) {
    return `Hier à ${time}`;
  }

  const day = date.toLocaleDateString('fr-FR');
  return `${day} à ${time}`;
}

/**
 * Explication en langage naturel d'une colonne reconnue — jamais les mots
 * "mapping", "correspondance", "confiance" ou "score" (voir décision validée).
 */
export function describeRecognizedField(field: FieldMappingResult): string {
  if (field.reason?.includes('corrigée manuellement')) {
    return 'Corrigée par vous';
  }
  if (field.reason?.includes('Mémorisé')) {
    return 'Retrouvée grâce à un import précédent';
  }
  return 'Retrouvée automatiquement dans votre fichier';
}
