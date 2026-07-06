import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { ImportType } from '../../../../generated/prisma/client';

export class ListImportLogsDto {
  @ApiPropertyOptional({ enum: ImportType })
  @IsOptional()
  @IsEnum(ImportType)
  type?: ImportType;
}
