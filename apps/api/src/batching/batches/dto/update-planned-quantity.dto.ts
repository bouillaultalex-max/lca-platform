import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsPositive } from 'class-validator';

export class UpdatePlannedQuantityDto {
  @ApiProperty({
    example: 2480,
    description:
      'Nouvelle quantité à produire (ex : ajustement à la quantité maximale réellement produisible).',
  })
  @IsInt()
  @IsPositive({ message: 'La quantité à produire doit être positive.' })
  plannedQuantity!: number;
}
