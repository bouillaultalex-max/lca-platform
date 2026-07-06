-- CreateEnum
CREATE TYPE "import_type" AS ENUM ('ARTICLES', 'STOCKS', 'BESOINS_ATTENDUS', 'INVENTAIRE');

-- CreateEnum
CREATE TYPE "import_status" AS ENUM ('PREVISUALISE', 'VALIDE', 'ERREUR');

-- CreateEnum
CREATE TYPE "export_type" AS ENUM ('PRODUCTIONS', 'CONSOMMATIONS', 'MOUVEMENTS_STOCK', 'INVENTAIRES', 'RAPPORTS');

-- CreateTable
CREATE TABLE "import_logs" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "type" "import_type" NOT NULL,
    "file_name" TEXT NOT NULL,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "import_status" NOT NULL,
    "processed_lines" INTEGER NOT NULL,
    "error_count" INTEGER NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_logs" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "type" "export_type" NOT NULL,
    "file_name" TEXT NOT NULL,
    "exported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "export_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expected_requirements" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "article_id" TEXT NOT NULL,
    "reserved_quantity" DECIMAL(65,30),
    "imported_requirement" DECIMAL(65,30),
    "imported_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expected_requirements_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "import_logs" ADD CONSTRAINT "import_logs_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_logs" ADD CONSTRAINT "import_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_logs" ADD CONSTRAINT "export_logs_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_logs" ADD CONSTRAINT "export_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expected_requirements" ADD CONSTRAINT "expected_requirements_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expected_requirements" ADD CONSTRAINT "expected_requirements_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
