import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class CreateJobTitleDto {
  @ApiProperty({ example: 'Responsable adjoint' })
  @IsString()
  @MinLength(1, { message: 'Le nom de la fonction est obligatoire.' })
  name!: string;
}
