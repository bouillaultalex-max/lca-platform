import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Min } from 'class-validator';

export class UpdateMinimumThresholdDto {
  @ApiProperty({
    example: 50,
    description:
      'Seuil de stock minimum (déclenche l’indicateur "stock faible").',
  })
  @IsNumber()
  @Min(0, { message: 'Le seuil minimum ne peut pas être négatif.' })
  minimumThreshold!: number;
}
