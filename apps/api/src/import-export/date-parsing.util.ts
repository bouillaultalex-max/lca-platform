/**
 * Interprétation d'une date de cellule importée, sous 3 formes explicites et
 * fermées (voir décision du 2026-07-06) : numéro de série Excel, ISO (AAAA-MM-JJ)
 * ou français (JJ/MM/AAAA). Volontairement sans bibliothèque de dates tierce.
 * Retourne toujours une chaîne ISO (AAAA-MM-JJ) ou `null` si invalide/non reconnue.
 */

const ISO_DATE_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;
const FRENCH_DATE_REGEX = /^(\d{2})\/(\d{2})\/(\d{4})$/;
/** Écart (en jours) entre l'époque Excel (30/12/1899) et l'époque Unix (01/01/1970). */
const EXCEL_EPOCH_OFFSET_DAYS = 25569;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * `Date.UTC`/`new Date(...)` normalisent silencieusement un jour hors calendrier
 * (ex: 31 février → 3 mars) plutôt que de signaler une erreur : on revalide donc
 * toujours en comparant les composants reconstruits à ceux demandés.
 */
function isExactCalendarDate(
  year: number,
  month: number,
  day: number,
  date: Date,
): boolean {
  return (
    !Number.isNaN(date.getTime()) &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day
  );
}

function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial)) return null;
  const date = new Date(
    Math.round((serial - EXCEL_EPOCH_OFFSET_DAYS) * MS_PER_DAY),
  );
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

export function parseDateToIso(raw: unknown): string | null {
  if (typeof raw === 'number') {
    return excelSerialToIso(raw);
  }

  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();

  const isoMatch = ISO_DATE_REGEX.exec(trimmed);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    const year = Number(y);
    const month = Number(m);
    const day = Number(d);
    const date = new Date(Date.UTC(year, month - 1, day));
    return isExactCalendarDate(year, month, day, date) ? trimmed : null;
  }

  const frenchMatch = FRENCH_DATE_REGEX.exec(trimmed);
  if (frenchMatch) {
    const [, d, m, y] = frenchMatch;
    const year = Number(y);
    const month = Number(m);
    const day = Number(d);
    const date = new Date(Date.UTC(year, month - 1, day));
    return isExactCalendarDate(year, month, day, date)
      ? `${y}-${m}-${d}`
      : null;
  }

  return null;
}
