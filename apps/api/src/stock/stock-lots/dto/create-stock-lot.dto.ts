import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

/**
 * Réception d'un lot physique (fût, seau, carton de packaging...). Crée un `StockLot`,
 * le `StockMovement` ENTREE associé, et incrémente `StockItem.availableQuantity`
 * (voir docs/modele-donnees.md §3).
 */
export class CreateStockLotDto {
  @ApiProperty({
    description:
      'Article réceptionné (matière première, packaging ou produit fini).',
  })
  @IsUUID()
  articleId!: string;

  @ApiProperty({ example: 'LOT-FOURNISSEUR-2026-001' })
  @IsString()
  @MinLength(1, { message: 'Le numéro de lot fournisseur est obligatoire.' })
  supplierLotNumber!: string;

  @ApiProperty({
    example: 200,
    description: 'Quantité reçue, dans l’unité de mesure de l’article.',
  })
  @IsNumber()
  @IsPositive({ message: 'La quantité reçue doit être positive.' })
  receivedQuantity!: number;

  @ApiProperty({ example: '2026-07-06' })
  @IsDateString()
  receivedAt!: string;

  @ApiPropertyOptional({ example: '2027-07-06' })
  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  comment?: string;
}
