import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import {
  QualityCheckResult,
  QualityCheckType,
} from '../../../../generated/prisma/client';

/**
 * Enregistrement d'un contrôle qualité (voir ADR 0008 — QUA-01). Immuable une
 * fois créé : aucun endpoint de modification ni de suppression en V1.
 */
export class CreateQualityCheckDto {
  @ApiProperty({ enum: QualityCheckType })
  @IsEnum(QualityCheckType, {
    message:
      'Le type doit être VISUEL, ORGANOLEPTIQUE, PHYSICO_CHIMIQUE, PACKAGING ou DOCUMENTAIRE.',
  })
  type!: QualityCheckType;

  @ApiProperty({ enum: QualityCheckResult })
  @IsEnum(QualityCheckResult, {
    message:
      'Le résultat doit être CONFORME, NON_CONFORME ou CONFORME_AVEC_RESERVE.',
  })
  result!: QualityCheckResult;

  @ApiPropertyOptional({
    example: '2026-08-17T10:00:00.000Z',
    description: 'Date/heure du contrôle réalisé — défaut : maintenant.',
  })
  @IsOptional()
  @IsDateString()
  checkedAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  comment?: string;
}
