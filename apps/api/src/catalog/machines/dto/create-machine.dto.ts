import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

export class CreateMachineDto {
  @ApiProperty({ example: 'CDA E-Fill 1' })
  @IsString()
  @MinLength(1, { message: 'Le nom de la machine est obligatoire.' })
  name!: string;

  @ApiProperty({ example: [50, 100, 200], type: [Number] })
  @IsArray()
  @ArrayNotEmpty({ message: 'La machine doit supporter au moins un format.' })
  @IsInt({
    each: true,
    message: 'Chaque format doit être un nombre entier (ml).',
  })
  @Min(1, { each: true, message: 'Chaque format doit être positif.' })
  supportedFormats!: number[];
}
