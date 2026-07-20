import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class CreateProductFamilyDto {
  @ApiProperty({ example: 'Recharge Lavande' })
  @IsString()
  @MinLength(1, {
    message: 'Le nom de la famille commerciale est obligatoire.',
  })
  name!: string;
}
