-- ADR 0010 — Numérotation partagée des lots par batch (socle Prisma uniquement,
-- voir docs/adr/0010-numerotation-partagee-lot-batch.md). Migration additive et
-- structurante non destructive : aucune donnée existante supprimée ou modifiée.

-- DropIndex
-- Retrait de l'unicité globale sur Lot.lotNumber (ADR 0010 § Décision 4) : un batch
-- multi-allocation partage désormais un seul lotNumber entre plusieurs Lot.
DROP INDEX "lots_lot_number_key";

-- AlterTable
-- Batch.reservedLotNumber / Batch.reservedExpiryDate (ADR 0010 § Décision 1) : numéro
-- réservé au lancement, DDM calculée une seule fois. Les deux colonnes sont nullable
-- au niveau Prisma ; leur co-nullabilité réelle est garantie par le CHECK ci-dessous,
-- pas par ce seul typage.
ALTER TABLE "batches" ADD COLUMN     "reserved_expiry_date" TIMESTAMP(3),
ADD COLUMN     "reserved_lot_number" TEXT;

-- AddCheckConstraint
-- Co-nullabilité de reserved_lot_number / reserved_expiry_date (ADR 0010 § Décision 2)
-- : les deux NULL, ou les deux renseignés — jamais un état intermédiaire. CHECK
-- portant sur deux colonnes de la même ligne de la même table (pleinement supporté
-- par PostgreSQL), à ne pas confondre avec un CHECK cross-table (impossible sans
-- trigger, non introduit ici).
ALTER TABLE "batches" ADD CONSTRAINT "batches_reserved_pair_coherent"
  CHECK (
    (reserved_lot_number IS NULL AND reserved_expiry_date IS NULL)
    OR
    (reserved_lot_number IS NOT NULL AND reserved_expiry_date IS NOT NULL)
  );

-- CreateTable
-- LotNumberCounter (ADR 0010 § Décision 5) : compteur persistant par site, une ligne
-- par site, jamais amorcé par une valeur par défaut Prisma — l'amorçage (456148 au
-- déploiement réel du laboratoire) est une donnée d'exploitation insérée
-- explicitement, hors de cette migration (ADR 0010 § Décision 5/7).
CREATE TABLE "lot_number_counters" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "last_issued_number" INTEGER NOT NULL,
    "last_issued_batch_id" TEXT,
    "last_issued_available_for_reuse" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lot_number_counters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lot_number_counters_site_id_key" ON "lot_number_counters"("site_id");

-- CreateIndex
-- Unicité scopée par site (ADR 0010 § Décision 1) : jamais une contrainte globale sur
-- reserved_lot_number seul — deux sites disposant chacun de leur propre compteur
-- peuvent légitimement produire le même numéro.
CREATE UNIQUE INDEX "batches_site_id_reserved_lot_number_key" ON "batches"("site_id", "reserved_lot_number");

-- CreateIndex
-- Remplace l'unicité globale retirée sur Lot.lotNumber (ADR 0010 § Décision 4) :
-- conserve la performance des lectures par (siteId, lotNumber) sans imposer l'unicité.
CREATE INDEX "lots_site_id_lot_number_idx" ON "lots"("site_id", "lot_number");

-- AddForeignKey
ALTER TABLE "lot_number_counters" ADD CONSTRAINT "lot_number_counters_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
