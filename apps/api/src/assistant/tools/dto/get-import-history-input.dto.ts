import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * `limit` provient d'un appel d'outil (argument déjà structuré fourni par le
 * fournisseur IA), jamais d'une query string HTTP — contrairement aux DTOs
 * d'endpoints REST, aucune coercition `@Type(() => Number)` n'est donc nécessaire ici.
 */
export class GetImportHistoryInputDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
