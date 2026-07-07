/**
 * Fonctions pures d'interprétation de valeurs de cellule, partagées par les services
 * métier d'import (articles, stocks...). Aucune connaissance de colonne ni de fichier
 * ici — uniquement "que signifie cette valeur brute", jamais "quelle colonne la porte"
 * (ça, c'est le rôle du moteur de mapping générique, voir ADR 0003).
 */

export function parseRequiredString(raw: unknown): string | null {
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof raw === 'number') {
    return String(raw);
  }
  return null;
}

/**
 * Nombre décimal, en tolérant la virgule française ("12,50"). Ne contraint pas le
 * signe : chaque appelant applique sa propre règle (positif strict, positif ou nul...).
 */
export function parseDecimal(raw: unknown): number | null {
  let value: number;
  if (typeof raw === 'number') {
    value = raw;
  } else if (typeof raw === 'string') {
    const normalized = raw.trim().replace(',', '.');
    if (normalized === '') return null;
    value = Number(normalized);
  } else {
    return null;
  }
  return Number.isFinite(value) ? value : null;
}
