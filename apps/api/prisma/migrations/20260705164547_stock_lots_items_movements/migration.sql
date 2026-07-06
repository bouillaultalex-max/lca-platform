-- CreateEnum
CREATE TYPE "stock_movement_type" AS ENUM ('ENTREE', 'SORTIE_BATCH', 'AJUSTEMENT_INVENTAIRE', 'EXPORT_OPENSI');

-- CreateTable
CREATE TABLE "stock_lots" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "article_id" TEXT NOT NULL,
    "supplier_lot_number" TEXT NOT NULL,
    "received_quantity" DECIMAL(65,30) NOT NULL,
    "remaining_quantity" DECIMAL(65,30) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL,
    "expiry_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_items" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "article_id" TEXT NOT NULL,
    "available_quantity" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "minimum_threshold" DECIMAL(65,30),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "article_id" TEXT NOT NULL,
    "stock_lot_id" TEXT,
    "type" "stock_movement_type" NOT NULL,
    "quantity" DECIMAL(65,30) NOT NULL,
    "movement_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" TEXT NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_lots_article_id_received_at_idx" ON "stock_lots"("article_id", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "stock_items_article_id_key" ON "stock_items"("article_id");

-- AddForeignKey
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_stock_lot_id_fkey" FOREIGN KEY ("stock_lot_id") REFERENCES "stock_lots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
