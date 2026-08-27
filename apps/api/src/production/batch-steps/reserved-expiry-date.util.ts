/**
 * DDM (date de durabilité minimale) d'un batch — voir ADR 0010 § Décision 12 :
 * `startedAt` (instant réel du lancement) + 3 ans calendaires, calculée une seule
 * fois au lancement, jamais recalculée ailleurs (impression, clôture).
 *
 * Cas du 29 février (année bissextile) : bascule au 1er mars les années où le 29
 * février n'existe pas (comportement natif de `Date.setFullYear`, confirmé comme
 * convention retenue faute de convention préexistante dans le projet — aucune
 * bibliothèque de date, aucun autre calcul de ce type ailleurs dans le code).
 */
export function computeReservedExpiryDate(startedAt: Date): Date {
  const expiryDate = new Date(startedAt);
  expiryDate.setFullYear(expiryDate.getFullYear() + 3);
  return expiryDate;
}
