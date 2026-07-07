import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { UserRole } from '../../../../generated/prisma/client';

export class CreateUserDto {
  @ApiProperty({ example: 'Kevin Prian' })
  @IsString()
  @MinLength(1, { message: 'Le nom complet est obligatoire.' })
  fullName!: string;

  @ApiProperty({ example: 'kevin.prian@lca-mes.local' })
  @IsEmail({}, { message: 'Adresse e-mail invalide.' })
  email!: string;

  @ApiProperty({ description: 'Identifiant de la fonction métier (JobTitle).' })
  @IsString()
  @MinLength(1, { message: 'La fonction métier est obligatoire.' })
  jobTitleId!: string;

  @ApiProperty({ enum: UserRole })
  @IsEnum(UserRole, { message: 'Rôle logiciel invalide.' })
  role!: UserRole;

  @ApiProperty({ default: false, required: false })
  @IsOptional()
  @IsBoolean()
  isSystemAdmin?: boolean;
}
