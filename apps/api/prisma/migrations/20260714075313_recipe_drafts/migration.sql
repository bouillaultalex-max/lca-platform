-- CreateTable
CREATE TABLE "recipe_drafts" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "finished_product_id" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recipe_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recipe_drafts_user_id_finished_product_id_key" ON "recipe_drafts"("user_id", "finished_product_id");

-- AddForeignKey
ALTER TABLE "recipe_drafts" ADD CONSTRAINT "recipe_drafts_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_drafts" ADD CONSTRAINT "recipe_drafts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_drafts" ADD CONSTRAINT "recipe_drafts_finished_product_id_fkey" FOREIGN KEY ("finished_product_id") REFERENCES "articles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
