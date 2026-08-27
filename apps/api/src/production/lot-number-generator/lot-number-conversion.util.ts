import { LotNumberConversionError } from './lot-number-generator.errors';

/**
 * Motif numérique entier strict (voir ADR 0010 § Décision 21) : uniquement des
 * chiffres ASCII, sans caractère superflu — rejette implicitement chaîne vide,
 * décimales, espaces (tête/fin/internes), signe (`+`/`-`) et notation scientifique.
 */
const STRICT_INTEGER_PATTERN = /^\d+$/;

/**
 * Conversion fail-closed d'une valeur vers un entier sûr (voir ADR 0010 § Décision 21).
 * Unique implémentation pour tout traitement numérique applicatif de `lotNumber` —
 * réutilisée par tout point de code ayant besoin de cette conversion (portée précisée
 * par l'ADR : ne s'applique pas à la procédure de déploiement, § Décision 7).
 *
 * Accepte `number` ou `string` (le second cas couvre la comparaison future
 * `Batch.reservedLotNumber` ↔ `LotNumberCounter.lastIssuedNumber`, § Décision 9 ; le
 * premier couvre la lecture défensive du compteur lui-même via `$queryRaw`, dont le
 * typage TypeScript n'est qu'une annotation, jamais une garantie d'exécution).
 *
 * Échec explicite (jamais un `NaN` silencieux, jamais `0`, jamais une comparaison
 * lexicographique) pour : `null`/`undefined`, chaîne vide, valeur non strictement
 * numérique, décimale, espaces, signe, ou valeur dépassant
 * `Number.MAX_SAFE_INTEGER` (perte de précision silencieuse au-delà).
 */
export function parseStrictSafeInteger(value: unknown): number {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new LotNumberConversionError(
        `Valeur numérique hors limite de précision entière sûre : ${value}.`,
      );
    }
    return value;
  }

  if (typeof value === 'string') {
    if (!STRICT_INTEGER_PATTERN.test(value)) {
      throw new LotNumberConversionError(
        `Valeur non strictement numérique pour une conversion fail-closed : ${JSON.stringify(value)}.`,
      );
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) {
      throw new LotNumberConversionError(
        `Valeur numérique hors limite de précision entière sûre : ${value}.`,
      );
    }
    return parsed;
  }

  throw new LotNumberConversionError(
    `Valeur absente ou de type invalide pour une conversion numérique fail-closed : ${JSON.stringify(value)}.`,
  );
}
