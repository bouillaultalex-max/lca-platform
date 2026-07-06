-- CreateEnum
CREATE TYPE "batch_status" AS ENUM ('PLANIFIE', 'EN_COURS', 'TERMINE', 'ANNULE');

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "batch_id" TEXT;

-- CreateTable
CREATE TABLE "batches" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "recipe_id" TEXT NOT NULL,
    "machine_id" TEXT NOT NULL,
    "format" INTEGER NOT NULL,
    "planned_quantity" INTEGER NOT NULL,
    "produced_quantity" INTEGER,
    "rejected_quantity" INTEGER,
    "started_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "format_changed" BOOLEAN NOT NULL DEFAULT false,
    "format_change_detail" TEXT,
    "status" "batch_status" NOT NULL DEFAULT 'PLANIFIE',
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batch_stops" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3),
    "duration_minutes" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "batch_stops_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "machines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_stops" ADD CONSTRAINT "batch_stops_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
