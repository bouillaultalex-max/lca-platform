-- CreateTable
CREATE TABLE "rnd_aroma_samples" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "legacy_id" TEXT NOT NULL,
    "supplier_name_raw" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "supplier_reference" TEXT,
    "category" TEXT NOT NULL DEFAULT 'Autre',
    "rating" DECIMAL(65,30),
    "stock_grams" DECIMAL(65,30),
    "price_per_kg_eur" DECIMAL(65,30),
    "added_at" TIMESTAMP(3),
    "comment" TEXT,
    "linked_article_id" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "import_log_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rnd_aroma_samples_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rnd_aroma_samples_site_id_active_idx" ON "rnd_aroma_samples"("site_id", "active");

-- CreateIndex
CREATE INDEX "rnd_aroma_samples_site_id_category_idx" ON "rnd_aroma_samples"("site_id", "category");

-- CreateIndex
CREATE INDEX "rnd_aroma_samples_site_id_supplier_name_raw_idx" ON "rnd_aroma_samples"("site_id", "supplier_name_raw");

-- CreateIndex
CREATE INDEX "rnd_aroma_samples_linked_article_id_idx" ON "rnd_aroma_samples"("linked_article_id");

-- CreateIndex
CREATE INDEX "rnd_aroma_samples_import_log_id_idx" ON "rnd_aroma_samples"("import_log_id");

-- CreateIndex
CREATE UNIQUE INDEX "rnd_aroma_samples_site_id_legacy_id_key" ON "rnd_aroma_samples"("site_id", "legacy_id");

-- AddForeignKey
ALTER TABLE "rnd_aroma_samples" ADD CONSTRAINT "rnd_aroma_samples_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rnd_aroma_samples" ADD CONSTRAINT "rnd_aroma_samples_linked_article_id_fkey" FOREIGN KEY ("linked_article_id") REFERENCES "articles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rnd_aroma_samples" ADD CONSTRAINT "rnd_aroma_samples_import_log_id_fkey" FOREIGN KEY ("import_log_id") REFERENCES "import_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
