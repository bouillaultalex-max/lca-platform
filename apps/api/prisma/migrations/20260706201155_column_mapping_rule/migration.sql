-- CreateTable
CREATE TABLE "column_mapping_rules" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "column_name_normalized" TEXT NOT NULL,
    "column_name_original" TEXT NOT NULL,
    "field_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "column_mapping_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "column_mapping_rules_site_id_source_entity_type_column_name_key" ON "column_mapping_rules"("site_id", "source", "entity_type", "column_name_normalized");

-- AddForeignKey
ALTER TABLE "column_mapping_rules" ADD CONSTRAINT "column_mapping_rules_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
