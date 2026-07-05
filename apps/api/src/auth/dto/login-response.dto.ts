import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '../../../generated/prisma/client';

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
