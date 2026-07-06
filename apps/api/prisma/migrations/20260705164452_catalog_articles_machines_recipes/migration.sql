-- CreateEnum
CREATE TYPE "article_type" AS ENUM ('MATIERE_PREMIERE', 'PACKAGING', 'PRODUIT_FINI');

-- CreateEnum
CREATE TYPE "recipe_status" AS ENUM ('ACTIVE', 'ARCHIVEE');

-- CreateTable
CREATE TABLE "articles" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "type" "article_type" NOT NULL,
    "opensi_reference" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit_of_measure" TEXT NOT NULL,
    "current_unit_cost" DECIMAL(65,30) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machines" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "supported_formats" INTEGER[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "machines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipes" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "finished_product_id" TEXT NOT NULL,
    "format" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "recipe_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_lines" (
    "id" TEXT NOT NULL,
    "recipe_id" TEXT NOT NULL,
    "article_id" TEXT NOT NULL,
    "quantity_per_unit" DECIMAL(65,30) NOT NULL,
    "unit" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recipe_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "articles_site_id_opensi_reference_key" ON "articles"("site_id", "opensi_reference");

-- CreateIndex
CREATE UNIQUE INDEX "recipes_finished_product_id_format_version_key" ON "recipes"("finished_product_id", "format", "version");

-- CreateIndex
CREATE UNIQUE INDEX "recipe_lines_recipe_id_article_id_key" ON "recipe_lines"("recipe_id", "article_id");

-- AddForeignKey
ALTER TABLE "articles" ADD CONSTRAINT "articles_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machines" ADD CONSTRAINT "machines_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_finished_product_id_fkey" FOREIGN KEY ("finished_product_id") REFERENCES "articles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_lines" ADD CONSTRAINT "recipe_lines_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_lines" ADD CONSTRAINT "recipe_lines_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
