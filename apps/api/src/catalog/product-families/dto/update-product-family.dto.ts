import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateProductFamilyDto } from './create-product-family.dto';

export class UpdateProductFamilyDto extends PartialType(
  CreateProductFamilyDto,
) {
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
