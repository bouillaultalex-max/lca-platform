-- AlterTable
ALTER TABLE "articles" ADD COLUMN     "market_id" TEXT,
ADD COLUMN     "product_family_id" TEXT;

-- AlterTable
ALTER TABLE "lots" ADD COLUMN     "allocation_id" TEXT;

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "batch_product_allocation_id" TEXT;

-- CreateTable
CREATE TABLE "markets" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "markets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_families" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_families_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batch_product_allocations" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "recipe_id" TEXT NOT NULL,
    "market_id" TEXT,
    "planned_quantity" INTEGER NOT NULL,
    "produced_quantity" INTEGER,
    "rejected_quantity" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "batch_product_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "batch_product_allocations_batch_id_product_id_key" ON "batch_product_allocations"("batch_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "batch_product_allocations_batch_id_market_id_key" ON "batch_product_allocations"("batch_id", "market_id");

-- CreateIndex
CREATE UNIQUE INDEX "articles_product_family_id_market_id_key" ON "articles"("product_family_id", "market_id");

-- CreateIndex
CREATE UNIQUE INDEX "lots_allocation_id_key" ON "lots"("allocation_id");

-- AddForeignKey
ALTER TABLE "articles" ADD CONSTRAINT "articles_product_family_id_fkey" FOREIGN KEY ("product_family_id") REFERENCES "product_families"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "articles" ADD CONSTRAINT "articles_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "markets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "markets" ADD CONSTRAINT "markets_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_families" ADD CONSTRAINT "product_families_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_batch_product_allocation_id_fkey" FOREIGN KEY ("batch_product_allocation_id") REFERENCES "batch_product_allocations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_product_allocations" ADD CONSTRAINT "batch_product_allocations_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_product_allocations" ADD CONSTRAINT "batch_product_allocations_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "articles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_product_allocations" ADD CONSTRAINT "batch_product_allocations_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_product_allocations" ADD CONSTRAINT "batch_product_allocations_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "markets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lots" ADD CONSTRAINT "lots_allocation_id_fkey" FOREIGN KEY ("allocation_id") REFERENCES "batch_product_allocations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

