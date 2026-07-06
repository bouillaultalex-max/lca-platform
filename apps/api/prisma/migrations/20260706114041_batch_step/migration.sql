-- CreateEnum
CREATE TYPE "batch_step" AS ENUM ('PREPARATION', 'MELANGE', 'INCORPORATION_TREMIE', 'CONDITIONNEMENT');

-- AlterTable
ALTER TABLE "batches" ADD COLUMN     "current_step" "batch_step";
