import { ApiProperty } from '@nestjs/swagger';
import { IsDateString } from 'class-validator';

export class EndBatchStopDto {
  @ApiProperty({ example: '2026-07-06T10:45:00.000Z' })
  @IsDateString()
  endedAt!: string;
}
