import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsString, MinLength } from 'class-validator';

export class CreateBatchStopDto {
  @ApiProperty({ example: 'Bourrage machine' })
  @IsString()
  @MinLength(1, { message: 'Le motif est obligatoire.' })
  reason!: string;

  @ApiProperty({ example: '2026-07-06T10:30:00.000Z' })
  @IsDateString()
  startedAt!: string;
}
