import { IsString, MinLength } from 'class-validator';

export class GetLotByNumberInputDto {
  @IsString()
  @MinLength(1, { message: 'Le numéro de lot est obligatoire.' })
  lotNumber!: string;
}
