-- CreateTable
CREATE TABLE "batch_costs" (
    "id" TEXT NOT NULL,
    "lot_id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "material_cost_total" DECIMAL(65,30) NOT NULL,
    "packaging_cost_total" DECIMAL(65,30) NOT NULL,
    "unit_cost_per_flacon" DECIMAL(65,30) NOT NULL,
    "produced_quantity_total" INTEGER NOT NULL,
    "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "batch_costs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "batch_costs_lot_id_key" ON "batch_costs"("lot_id");

-- AddForeignKey
ALTER TABLE "batch_costs" ADD CONSTRAINT "batch_costs_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_costs" ADD CONSTRAINT "batch_costs_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
