/**
 * Erreurs du mécanisme de numérotation persistante (voir ADR 0010). Volontairement peu
 * nombreuses (pas de hiérarchie dédiée) : elles servent uniquement à ce que l'appelant
 * puisse distinguer par type la cause d'un échec et lui appliquer le mapping métier
 * défini par ADR 0010 § Décision 20 — ce mapping n'est pas implémenté ici.
 */

/** Aucune ligne `LotNumberCounter` pour ce site (voir ADR 0010 § Décision 6) : aucun
 * numéro n'est inventé, aucune ligne n'est créée implicitement. */
export class LotNumberCounterNotFoundError extends Error {
  constructor(public readonly siteId: string) {
    super(
      `Aucun compteur de numérotation de lot initialisé pour le site ${siteId}.`,
    );
    this.name = 'LotNumberCounterNotFoundError';
  }
}

/** Échec de la conversion numérique fail-closed (voir ADR 0010 § Décision 21) : valeur
 * absente, non strictement numérique, ou dépassant la précision entière sûre. */
export class LotNumberConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LotNumberConversionError';
  }
}

/** Incohérence détectée entre `Batch.reservedLotNumber` et l'état de
 * `LotNumberCounter` au moment d'une libération (voir ADR 0010 § Décision 9/11) :
 * le compteur indique que ce numéro est le dernier émis, mais `lastIssuedBatchId` ne
 * correspond pas au batch qui tente de le libérer. Ne devrait jamais se produire si
 * le flux d'attribution est correctement implémenté (chaque attribution pose les
 * deux champs ensemble, atomiquement) — sa survenue signale un bug à investiguer,
 * jamais un cas métier normal. Ne jamais deviner, ne jamais forcer la réutilisation,
 * ne jamais modifier le compteur de façon destructive dans ce cas. */
export class LotNumberCounterInconsistentError extends Error {
  constructor(
    public readonly siteId: string,
    public readonly batchId: string,
  ) {
    super(
      `Le compteur de numérotation du site ${siteId} est incohérent avec le batch ${batchId} : ` +
        'le dernier numéro émis ne correspond pas à ce batch. Annulation refusée.',
    );
    this.name = 'LotNumberCounterInconsistentError';
  }
}
