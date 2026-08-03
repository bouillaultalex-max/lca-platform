-- AlterEnum
ALTER TYPE "import_type" ADD VALUE 'AROMATHEQUE';

-- AlterTable
ALTER TABLE "import_logs" ADD COLUMN     "preview_hash" TEXT;
