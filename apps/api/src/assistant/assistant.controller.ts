import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AssistantService } from './assistant.service';
import { SendAssistantMessageDto } from './dto/send-assistant-message.dto';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';

const HEARTBEAT_INTERVAL_MS = 15_000;

/**
 * Ouvert à tout utilisateur authentifié — comme stock/traceability/dashboard,
 * aucun `@Roles()` ici. `JwtAuthGuard`/`RolesGuard` s'appliquent déjà
 * globalement (voir AuthModule, `APP_GUARD`) : aucune configuration
 * supplémentaire n'est nécessaire pour que ce contrôleur en bénéficie.
 * L'identité provient exclusivement de `@CurrentUser()` (peuplé par le JWT déjà
 * vérifié), jamais reconstruite depuis un paramètre de requête.
 */
@ApiTags('assistant')
@ApiBearerAuth()
@Controller('assistant')
export class AssistantController {
  constructor(private readonly assistantService: AssistantService) {}

  @Post('messages')
  @ApiOperation({
    summary:
      "Envoie un message à l'assistant et reçoit la réponse en flux (Server-Sent Events). " +
      'Infrastructure uniquement (AI-02) : aucun outil métier, réponse simulée.',
  })
  async streamMessage(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SendAssistantMessageDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      // Désactive la mise en tampon d'un éventuel proxy inverse (ex: nginx) —
      // sans effet en développement, documente l'intention pour un futur déploiement.
      'X-Accel-Buffering': 'no',
    });

    // Annulation : le client ferme la connexion (bouton "Arrêter", changement de
    // page, timeout réseau) → on cesse d'écrire dans le flux dès l'événement en
    // cours traité, sans jamais tenter d'écrire après la fermeture du socket.
    let closed = false;
    req.on('close', () => {
      closed = true;
    });

    const heartbeat = setInterval(() => {
      if (!closed) res.write(': heartbeat\n\n');
    }, HEARTBEAT_INTERVAL_MS);

    try {
      for await (const event of this.assistantService.streamMessage(
        user,
        dto,
      )) {
        if (closed) break;
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } finally {
      clearInterval(heartbeat);
      if (!closed) res.end();
    }
  }
}
