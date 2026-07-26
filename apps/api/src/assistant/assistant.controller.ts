import { Body, Controller, Post, Req, Res, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AssistantService } from './assistant.service';
import { SendAssistantMessageDto } from './dto/send-assistant-message.dto';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { AssistantThrottlerGuard } from './assistant-throttler.guard';
import {
  ASSISTANT_THROTTLE_LIMIT,
  ASSISTANT_THROTTLE_TTL_MS,
} from './assistant-throttle.constants';

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

  // Limitation de débit (voir AI-08) : seule cette route l'applique dans tout
  // le module — AssistantThrottlerGuard n'est volontairement pas un garde
  // global (même principe que ThrottlerGuard sur POST /auth/login, SEC-02).
  // `@Throttle` surcharge, pour cette seule route, le couple limite/fenêtre du
  // throttler global déjà enregistré par AuthModule.
  @UseGuards(AssistantThrottlerGuard)
  @Throttle({
    default: {
      limit: ASSISTANT_THROTTLE_LIMIT,
      ttl: ASSISTANT_THROTTLE_TTL_MS,
    },
  })
  @Post('messages')
  @ApiOperation({
    summary:
      "Envoie un message à l'assistant et reçoit la réponse en flux (Server-Sent Events). " +
      'Aucune action métier : les outils enregistrés (AI-03) sont en lecture seule.',
  })
  @ApiResponse({
    status: 429,
    description: 'Trop de messages envoyés, réessayez plus tard.',
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
    // `abortController` (AI-03) propage cette même annulation jusqu'au
    // fournisseur IA (voir AssistantService/AiProvider), pas seulement à
    // l'écriture HTTP.
    let closed = false;
    const abortController = new AbortController();
    req.on('close', () => {
      closed = true;
      abortController.abort();
    });

    const heartbeat = setInterval(() => {
      if (!closed) res.write(': heartbeat\n\n');
    }, HEARTBEAT_INTERVAL_MS);

    try {
      for await (const event of this.assistantService.streamMessage(
        user,
        dto,
        abortController.signal,
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
