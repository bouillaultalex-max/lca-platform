import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class CreateMarketDto {
  @ApiProperty({ example: 'FR' })
  @IsString()
  @MinLength(1, { message: 'Le code du marché est obligatoire.' })
  code!: string;

  @ApiProperty({ example: 'France' })
  @IsString()
  @MinLength(1, { message: 'Le libellé du marché est obligatoire.' })
  label!: string;
}
