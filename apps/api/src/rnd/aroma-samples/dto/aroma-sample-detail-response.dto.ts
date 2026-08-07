import { ApiProperty } from '@nestjs/swagger';
import { ImportStatus, ImportType } from '../../../../generated/prisma/client';

/**
 * Résumé du dernier `ImportLog` ayant créé ou mis à jour cet échantillon (voir
 * `RndAromaSample.importLogId`) — jamais un historique complet des imports
 * successifs : le modèle ne conserve que la dernière écriture (voir RD-01C-3),
 * pas chaque import qui a un jour touché cette ligne. Ne porte jamais `previewHash`
 * (empreinte d'intégrité interne à l'import) ni `errorDetails` complet (détail
 * ligne par ligne, hors périmètre d'une fiche de consultation), ni `siteId`.
 */
export class AromaSampleImportLogSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ImportType })
  type!: ImportType;

  @ApiProperty({ enum: ImportStatus })
  status!: ImportStatus;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  processedLines!: number;

  @ApiProperty()
  errorCount!: number;
}

/**
 * Fiche détail d'un échantillon d'aromathèque (voir RD-01D-2). Mêmes champs que la
 * ligne de liste (RD-01D-1), enrichis de l'import d'origine. Jamais `siteId` ni
 * `linkedArticleId` : aucune liaison recette/article n'existe encore (hors périmètre).
 * Décrit uniquement la forme de la réponse API — la logique de lecture reste dans
 * `AromaSamplesService.findOne()`.
 */
export class AromaSampleDetailResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  legacyId!: string;

  @ApiProperty()
  supplierNameRaw!: string;

  @ApiProperty()
  productName!: string;

  @ApiProperty({ nullable: true })
  supplierReference!: string | null;

  @ApiProperty()
  category!: string;

  @ApiProperty({ nullable: true })
  rating!: number | null;

  @ApiProperty({ nullable: true })
  stockGrams!: number | null;

  @ApiProperty({ nullable: true })
  pricePerKgEur!: number | null;

  @ApiProperty({ nullable: true })
  addedAt!: Date | null;

  @ApiProperty({ nullable: true })
  comment!: string | null;

  @ApiProperty()
  active!: boolean;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  @ApiProperty({ type: AromaSampleImportLogSummaryDto, nullable: true })
  importLog!: AromaSampleImportLogSummaryDto | null;
}
