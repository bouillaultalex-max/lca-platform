import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'responsable@lca-mes.local' })
  @IsEmail({}, { message: "L'email doit être une adresse valide." })
  email!: string;

  @ApiProperty({ example: 'un-mot-de-passe-fort' })
  @IsString()
  @MinLength(8, {
    message: 'Le mot de passe doit contenir au moins 8 caractères.',
  })
  password!: string;
}
