import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import {
  LotNumberCounterInconsistentError,
  LotNumberCounterNotFoundError,
} from './lot-number-generator.errors';
import { parseStrictSafeInteger } from './lot-number-conversion.util';

interface LotCounter {
  lot: { count: (args: { where: { siteId: string } }) => Promise<number> };
}

/** Forme de la ligne `lot_number_counters` telle que retournée par la lecture sous
 * verrou (`$queryRaw`) — le typage TypeScript ci-dessous n'est qu'une annotation,
 * jamais une garantie d'exécution : `lastIssuedNumber` est revalidé explicitement via
 * `parseStrictSafeInteger` avant tout usage (voir ADR 0010 § Décision 21). */
interface RawLotNumberCounterRow {
  lastIssuedNumber: unknown;
  lastIssuedAvailableForReuse: boolean;
}

/** Variante de `RawLotNumberCounterRow` incluant `lastIssuedBatchId`, nécessaire à la
 * vérification de cohérence stricte lors d'une libération (voir § Décision 9/11). */
interface RawLotNumberCounterRowWithBatch extends RawLotNumberCounterRow {
  lastIssuedBatchId: string | null;
}

@Injectable()
export class LotNumberGeneratorService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Repli transitoire historique — **conservé tel quel, jamais modifié** (voir
   * ADR 0010 § Décision 14) : seul `BatchClosureService.close` continue d'appeler
   * cette méthode, strictement pour les batchs `EN_COURS` antérieurs au déploiement
   * du nouveau mécanisme (`batch.reservedLotNumber === null`). Convention interne
   * historique : 6 chiffres commençant par 455 (`455XXX`), voir docs/regles-metier.md
   * §4. Ne gère pas les collisions concurrentes ni la réutilisation — acceptable
   * uniquement parce que ce chemin est désormais transitoire et amené à disparaître
   * (aucun nouveau batch ne l'emprunte, voir `reserveLotNumber` ci-dessous pour le
   * mécanisme nominal).
   */
  async generate(
    siteId: string,
    client: LotCounter = this.prisma,
  ): Promise<string> {
    const existingCount = await client.lot.count({ where: { siteId } });
    return `455${String(existingCount + 1).padStart(3, '0')}`;
  }

  /**
   * Mécanisme nominal d'attribution/réutilisation de numéro de lot (voir ADR 0010
   * § Décisions 5, 8, 9, 10, 21). Doit être appelée à l'intérieur de la transaction
   * appelante (`tx`) — n'ouvre jamais sa propre transaction, ne relâche jamais le
   * verrou avant que la transaction appelante ne commit/rollback. Aucun appelant à ce
   * stade (câblage réel dans `BatchStepsService.advance`, étape ultérieure) — cette
   * méthode est indépendante de `generate()` ci-dessus, qui reste le seul point
   * d'entrée du repli legacy.
   *
   * @param siteId Site dont le compteur doit être verrouillé/mis à jour.
   * @param batchId Batch bénéficiant de l'attribution — dénormalisé dans
   *   `lastIssuedBatchId` à titre purement informatif (jamais relu par cet
   *   algorithme, voir § Décision 5).
   * @param tx Client Prisma transactionnel de l'appelant. Jamais `this.prisma`.
   * @throws LotNumberCounterNotFoundError si aucun compteur n'existe pour ce site
   *   (§ Décision 6) — aucune ligne n'est créée implicitement, aucun numéro inventé.
   * @throws LotNumberConversionError si l'état lu du compteur n'est pas un entier sûr
   *   (défense en profondeur, § Décision 21) — ne devrait jamais survenir en pratique
   *   (colonne `Int` PostgreSQL), mais jamais transformé en `NaN`/`0` silencieux.
   */
  async reserveLotNumber(
    siteId: string,
    batchId: string,
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    const rows = await tx.$queryRaw<RawLotNumberCounterRow[]>`
      SELECT
        last_issued_number AS "lastIssuedNumber",
        last_issued_available_for_reuse AS "lastIssuedAvailableForReuse"
      FROM lot_number_counters
      WHERE site_id = ${siteId}
      FOR UPDATE
    `;

    const counter = rows[0];
    if (!counter) {
      throw new LotNumberCounterNotFoundError(siteId);
    }

    const lastIssuedNumber = parseStrictSafeInteger(counter.lastIssuedNumber);
    const isReusable = counter.lastIssuedAvailableForReuse === true;
    const nextNumber = isReusable
      ? lastIssuedNumber
      : parseStrictSafeInteger(lastIssuedNumber + 1);

    await tx.lotNumberCounter.update({
      where: { siteId },
      data: {
        lastIssuedNumber: nextNumber,
        lastIssuedBatchId: batchId,
        lastIssuedAvailableForReuse: false,
      },
    });

    return String(nextNumber);
  }

  /**
   * Libération conditionnelle d'un numéro à l'annulation d'un batch `EN_COURS` (voir
   * ADR 0010 § Décisions 9/11). Ne rend le numéro réutilisable que s'il s'agit très
   * exactement du dernier numéro émis pour ce site **et** que ce dernier numéro a bien
   * été émis pour ce batch précis — jamais un balayage de `Lot`, jamais une
   * réutilisation d'un numéro intermédiaire déjà dépassé. Doit être appelée à
   * l'intérieur de la transaction appelante (`tx`), après verrouillage du `Batch`
   * concerné (voir ADR 0010 § Décision 8 : `Batch` avant `LotNumberCounter`).
   *
   * @param siteId Site dont le compteur doit être verrouillé.
   * @param batchId Batch qui libère sa réservation.
   * @param reservedLotNumber `Batch.reservedLotNumber` (`String`) au moment de
   *   l'annulation — converti de façon fail-closed (§ Décision 21) avant comparaison,
   *   jamais une comparaison lexicographique.
   * @param tx Client Prisma transactionnel de l'appelant. Jamais `this.prisma`.
   * @returns `true` si le numéro a été marqué réutilisable, `false` s'il s'agissait
   *   d'un numéro intermédiaire déjà dépassé (perdu définitivement, aucune écriture).
   * @throws LotNumberCounterNotFoundError si aucun compteur n'existe pour ce site
   *   (état incohérent défensif : un batch réservé implique nécessairement un
   *   compteur existant).
   * @throws LotNumberCounterInconsistentError si le compteur indique que ce numéro
   *   est le dernier émis mais pour un batch différent — jamais deviné, jamais forcé,
   *   jamais de modification destructive du compteur dans ce cas.
   */
  async releaseLotNumber(
    siteId: string,
    batchId: string,
    reservedLotNumber: string,
    tx: Prisma.TransactionClient,
  ): Promise<boolean> {
    const rows = await tx.$queryRaw<RawLotNumberCounterRowWithBatch[]>`
      SELECT
        last_issued_number AS "lastIssuedNumber",
        last_issued_batch_id AS "lastIssuedBatchId",
        last_issued_available_for_reuse AS "lastIssuedAvailableForReuse"
      FROM lot_number_counters
      WHERE site_id = ${siteId}
      FOR UPDATE
    `;

    const counter = rows[0];
    if (!counter) {
      throw new LotNumberCounterNotFoundError(siteId);
    }

    const lastIssuedNumber = parseStrictSafeInteger(counter.lastIssuedNumber);
    const releasedNumber = parseStrictSafeInteger(reservedLotNumber);

    if (releasedNumber !== lastIssuedNumber) {
      // Numéro intermédiaire déjà dépassé : perdu définitivement, aucune écriture,
      // jamais un balayage de Lot pour tenter de le récupérer autrement.
      return false;
    }

    if (counter.lastIssuedBatchId !== batchId) {
      throw new LotNumberCounterInconsistentError(siteId, batchId);
    }

    await tx.lotNumberCounter.update({
      where: { siteId },
      data: { lastIssuedAvailableForReuse: true },
    });

    return true;
  }
}
