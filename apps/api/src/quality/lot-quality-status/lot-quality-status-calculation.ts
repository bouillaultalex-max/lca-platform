import {
  LotQualityStatus,
  QualityCheckResult,
} from '../../../generated/prisma/client';

/**
 * Calcul pur (aucun accès base) du statut qualité global d'un lot à partir de
 * l'ensemble des résultats de ses `QualityCheck` (voir ADR 0008, décision 1 —
 * QUA-03) : un seul `NON_CONFORME` suffit à rendre le lot `NON_CONFORME` ;
 * `CONFORME_AVEC_RESERVE` est traité comme `CONFORME` ; `BLOQUE` n'est jamais
 * produit automatiquement. Aucun scoring, aucune pondération.
 */
export function computeLotQualityStatus(
  results: QualityCheckResult[],
): LotQualityStatus {
  if (results.length === 0) {
    return LotQualityStatus.EN_ATTENTE;
  }
  if (results.includes(QualityCheckResult.NON_CONFORME)) {
    return LotQualityStatus.NON_CONFORME;
  }
  return LotQualityStatus.CONFORME;
}
