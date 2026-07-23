import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class SendAssistantMessageDto {
  @ApiPropertyOptional({
    description:
      "Identifiant d'une conversation existante. Absent pour démarrer une nouvelle conversation.",
  })
  @IsOptional()
  @IsUUID()
  conversationId?: string;

  @ApiProperty({ example: 'Bonjour, que peux-tu faire ?' })
  @IsString()
  @MinLength(1, { message: 'Le message est obligatoire.' })
  content!: string;
}
