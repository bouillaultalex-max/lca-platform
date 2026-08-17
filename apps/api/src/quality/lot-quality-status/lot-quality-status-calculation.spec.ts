import { computeLotQualityStatus } from './lot-quality-status-calculation';
import {
  LotQualityStatus,
  QualityCheckResult,
} from '../../../generated/prisma/client';

describe('computeLotQualityStatus (fonction pure, ADR 0008 — QUA-03)', () => {
  it('retourne EN_ATTENTE si aucun contrôle n’existe', () => {
    expect(computeLotQualityStatus([])).toBe(LotQualityStatus.EN_ATTENTE);
  });

  it('retourne CONFORME pour un seul contrôle CONFORME', () => {
    expect(computeLotQualityStatus([QualityCheckResult.CONFORME])).toBe(
      LotQualityStatus.CONFORME,
    );
  });

  it('retourne CONFORME pour un seul contrôle CONFORME_AVEC_RESERVE (traité comme CONFORME)', () => {
    expect(
      computeLotQualityStatus([QualityCheckResult.CONFORME_AVEC_RESERVE]),
    ).toBe(LotQualityStatus.CONFORME);
  });

  it('retourne NON_CONFORME pour un seul contrôle NON_CONFORME', () => {
    expect(computeLotQualityStatus([QualityCheckResult.NON_CONFORME])).toBe(
      LotQualityStatus.NON_CONFORME,
    );
  });

  it('retourne NON_CONFORME dès qu’un seul contrôle parmi plusieurs est NON_CONFORME', () => {
    expect(
      computeLotQualityStatus([
        QualityCheckResult.CONFORME,
        QualityCheckResult.NON_CONFORME,
        QualityCheckResult.CONFORME_AVEC_RESERVE,
      ]),
    ).toBe(LotQualityStatus.NON_CONFORME);
  });

  it('retourne CONFORME si tous les contrôles sont CONFORME ou CONFORME_AVEC_RESERVE (aucun NON_CONFORME)', () => {
    expect(
      computeLotQualityStatus([
        QualityCheckResult.CONFORME,
        QualityCheckResult.CONFORME_AVEC_RESERVE,
      ]),
    ).toBe(LotQualityStatus.CONFORME);
  });

  it('n’est pas sensible à l’ordre des contrôles', () => {
    const a = computeLotQualityStatus([
      QualityCheckResult.NON_CONFORME,
      QualityCheckResult.CONFORME,
    ]);
    const b = computeLotQualityStatus([
      QualityCheckResult.CONFORME,
      QualityCheckResult.NON_CONFORME,
    ]);
    expect(a).toBe(b);
    expect(a).toBe(LotQualityStatus.NON_CONFORME);
  });

  it('ne produit jamais BLOQUE automatiquement, quelle que soit la combinaison de résultats', () => {
    const combinations: QualityCheckResult[][] = [
      [],
      [QualityCheckResult.CONFORME],
      [QualityCheckResult.NON_CONFORME],
      [QualityCheckResult.CONFORME_AVEC_RESERVE],
      [
        QualityCheckResult.CONFORME,
        QualityCheckResult.NON_CONFORME,
        QualityCheckResult.CONFORME_AVEC_RESERVE,
      ],
    ];
    for (const results of combinations) {
      expect(computeLotQualityStatus(results)).not.toBe(
        LotQualityStatus.BLOQUE,
      );
    }
  });
});
