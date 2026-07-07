import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '../../../generated/prisma/client';

export class JobTitleSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;
}

export class UserSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  siteId!: string;

  @ApiProperty()
  fullName!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty({ enum: UserRole })
  role!: UserRole;

  @ApiProperty({ type: JobTitleSummaryDto, nullable: true })
  jobTitle!: JobTitleSummaryDto | null;

  @ApiProperty()
  isSystemAdmin!: boolean;

  @ApiProperty()
  mustChangePassword!: boolean;

  @ApiProperty({ nullable: true })
  lastLoginAt!: Date | null;
}

export class LoginResponseDto {
  @ApiProperty({
    description:
      'Jeton JWT à transmettre dans le header Authorization: Bearer <token>',
  })
  accessToken!: string;

  @ApiProperty({ type: UserSummaryDto })
  user!: UserSummaryDto;
}
