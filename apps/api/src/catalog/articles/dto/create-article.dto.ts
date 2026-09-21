import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ArticleType } from '../../../../generated/prisma/client';

export class CreateArticleDto {
  @ApiProperty({ enum: ArticleType })
  @IsEnum(ArticleType, {
    message: 'Le type doit être MATIERE_PREMIERE, PACKAGING ou PRODUIT_FINI.',
  })
  type!: ArticleType;

  @ApiProperty({ example: 'MP-LAVANDE' })
  @IsString()
  @MinLength(1, { message: 'La référence OpenSi est obligatoire.' })
  openSiReference!: string;

  @ApiProperty({ example: 'Parfum ambiance lavande (vrac)' })
  @IsString()
  @MinLength(1, { message: 'La désignation est obligatoire.' })
  name!: string;

  @ApiPropertyOptional({
    example: 'L',
    description:
      "Obligatoire et significative uniquement pour une matière première (ex. L, kg). Ignorée pour PACKAGING/PRODUIT_FINI — le serveur y substitue systématiquement la valeur technique 'unité' (voir ArticlesService.resolveUnitOfMeasure).",
  })
  @ValidateIf((dto: CreateArticleDto) => dto.type === ArticleType.MATIERE_PREMIERE)
  @IsString()
  @MinLength(1, {
    message: "L'unité de mesure est obligatoire pour une matière première.",
  })
  unitOfMeasure?: string;

  @ApiProperty({ example: 12.5 })
  @IsNumber({}, { message: 'Le coût unitaire doit être un nombre.' })
  @Min(0, { message: 'Le coût unitaire ne peut pas être négatif.' })
  currentUnitCost!: number;

  @ApiPropertyOptional({
    example: 100,
    description:
      "Conditionnement en carton, pour l'affichage uniquement (le stock reste compté en unités). " +
      'Valeur libre par article, non figée en dur — suggestion : 100 pour les flacons 10/30/50/100 ml, 36 pour les flacons 200 ml.',
  })
  @IsOptional()
  @IsInt()
  @IsPositive({ message: 'Le nombre d’unités par carton doit être positif.' })
  unitsPerCarton?: number;

  @ApiPropertyOptional({
    example: 0.98,
    description:
      'Densité (kg par litre), matières premières uniquement — permet de calculer la masse à peser en ' +
      'préparation de batch. Optionnelle, aucune valeur par défaut : si absente, seul le volume est affiché.',
  })
  @IsOptional()
  @IsNumber()
  @IsPositive({ message: 'La densité doit être positive.' })
  densityKgPerL?: number;

  @ApiPropertyOptional({
    description:
      'Fournisseur principal, matières premières et packaging uniquement — jamais produit fini (voir ArticlesService). Un seul fournisseur principal par article en V0.9.',
  })
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiPropertyOptional({
    description:
      'Famille commerciale de déclinaison, pertinente pour un PRODUIT_FINI (voir ADR 0006, PRD-11).',
  })
  @IsOptional()
  @IsUUID()
  productFamilyId?: string;

  @ApiPropertyOptional({
    description:
      "Marché de déclinaison au sein de la famille commerciale — ne peut être renseigné que si productFamilyId l'est aussi (voir ADR 0006, PRD-11).",
  })
  @IsOptional()
  @IsUUID()
  marketId?: string;
}
