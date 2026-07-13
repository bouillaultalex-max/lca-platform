import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateSupplierDto {
  @ApiProperty({ example: 'Sensient Flavors' })
  @IsString()
  @MinLength(1, { message: 'Le nom du fournisseur est obligatoire.' })
  name!: string;

  @ApiPropertyOptional({ example: 'Marie Dupont' })
  @IsOptional()
  @IsString()
  contactName?: string;

  @ApiPropertyOptional({ example: '+33 1 23 45 67 89' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: 'contact@sensient-flavors.com' })
  @IsOptional()
  @IsEmail({}, { message: "L'e-mail du fournisseur n'est pas valide." })
  email?: string;
}
