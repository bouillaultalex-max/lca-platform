import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import {
  FeedbackPriority,
  FeedbackType,
} from '../../../generated/prisma/client';

export class CreateFeedbackDto {
  @ApiProperty({ enum: FeedbackType })
  @IsEnum(FeedbackType, {
    message: 'Le type de retour doit être Bug, Idée, Amélioration ou Question.',
  })
  type!: FeedbackType;

  @ApiPropertyOptional({
    enum: FeedbackPriority,
    default: FeedbackPriority.NORMALE,
  })
  @IsOptional()
  @IsEnum(FeedbackPriority, {
    message: 'La priorité doit être Normale, Importante ou Bloquante.',
  })
  priority?: FeedbackPriority;

  @ApiProperty({ example: 'Le bouton Enregistrer ne répond pas sur mobile.' })
  @IsString()
  @MinLength(1, { message: 'Le message est obligatoire.' })
  message!: string;

  @ApiProperty({ example: '/catalog' })
  @IsString()
  @MinLength(1, { message: 'La page courante est obligatoire.' })
  pageUrl!: string;
}
