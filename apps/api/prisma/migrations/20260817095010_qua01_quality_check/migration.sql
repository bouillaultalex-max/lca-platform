-- CreateEnum
CREATE TYPE "quality_check_type" AS ENUM ('VISUEL', 'ORGANOLEPTIQUE', 'PHYSICO_CHIMIQUE', 'PACKAGING', 'DOCUMENTAIRE');

-- CreateEnum
CREATE TYPE "quality_check_result" AS ENUM ('CONFORME', 'NON_CONFORME', 'CONFORME_AVEC_RESERVE');

-- CreateTable
CREATE TABLE "quality_checks" (
    "id" TEXT NOT NULL,
    "lot_id" TEXT NOT NULL,
    "type" "quality_check_type" NOT NULL,
    "result" "quality_check_result" NOT NULL,
    "controller_user_id" TEXT NOT NULL,
    "checked_at" TIMESTAMP(3) NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quality_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quality_checks_lot_id_idx" ON "quality_checks"("lot_id");

-- AddForeignKey
ALTER TABLE "quality_checks" ADD CONSTRAINT "quality_checks_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_checks" ADD CONSTRAINT "quality_checks_controller_user_id_fkey" FOREIGN KEY ("controller_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
