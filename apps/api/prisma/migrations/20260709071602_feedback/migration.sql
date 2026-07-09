-- CreateEnum
CREATE TYPE "feedback_type" AS ENUM ('BUG', 'IDEE', 'AMELIORATION', 'QUESTION');

-- CreateEnum
CREATE TYPE "feedback_priority" AS ENUM ('NORMALE', 'IMPORTANTE', 'BLOQUANTE');

-- CreateEnum
CREATE TYPE "feedback_status" AS ENUM ('NOUVEAU', 'TRAITE');

-- CreateTable
CREATE TABLE "feedback" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "feedback_type" NOT NULL,
    "priority" "feedback_priority" NOT NULL DEFAULT 'NORMALE',
    "message" TEXT NOT NULL,
    "page_url" TEXT NOT NULL,
    "app_version" TEXT NOT NULL,
    "status" "feedback_status" NOT NULL DEFAULT 'NOUVEAU',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
