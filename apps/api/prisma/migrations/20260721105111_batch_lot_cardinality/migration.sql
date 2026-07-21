-- DropIndex
DROP INDEX "lots_batch_id_key";

-- CreateIndex
CREATE INDEX "lots_batch_id_idx" ON "lots"("batch_id");
