-- DropIndex
DROP INDEX "column_mapping_rules_site_id_source_entity_type_column_name_key";

-- AlterTable
ALTER TABLE "column_mapping_rules" ADD COLUMN     "source_version" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "column_mapping_rules_site_id_source_source_version_entity_t_key" ON "column_mapping_rules"("site_id", "source", "source_version", "entity_type", "column_name_normalized");
