-- CreateEnum
CREATE TYPE "lot_quality_status" AS ENUM ('EN_ATTENTE', 'CONFORME', 'NON_CONFORME', 'BLOQUE');

-- CreateTable
CREATE TABLE "lots" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "lot_number" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "manufactured_at" TIMESTAMP(3) NOT NULL,
    "expiry_date" TIMESTAMP(3),
    "quality_status" "lot_quality_status" NOT NULL DEFAULT 'EN_ATTENTE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lot_genealogies" (
    "id" TEXT NOT NULL,
    "lot_id" TEXT NOT NULL,
    "consumed_article_id" TEXT NOT NULL,
    "consumed_stock_lot_id" TEXT NOT NULL,
    "consumed_quantity" DECIMAL(65,30) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lot_genealogies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "lots_batch_id_key" ON "lots"("batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "lots_lot_number_key" ON "lots"("lot_number");

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot_genealogies" ADD CONSTRAINT "lot_genealogies_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot_genealogies" ADD CONSTRAINT "lot_genealogies_consumed_article_id_fkey" FOREIGN KEY ("consumed_article_id") REFERENCES "articles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lot_genealogies" ADD CONSTRAINT "lot_genealogies_consumed_stock_lot_id_fkey" FOREIGN KEY ("consumed_stock_lot_id") REFERENCES "stock_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
