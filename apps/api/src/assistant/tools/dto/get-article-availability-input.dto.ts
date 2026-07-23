import { IsString, MinLength } from 'class-validator';

export class GetArticleAvailabilityInputDto {
  @IsString()
  @MinLength(1, { message: 'La recherche ne peut pas être vide.' })
  query!: string;
}
