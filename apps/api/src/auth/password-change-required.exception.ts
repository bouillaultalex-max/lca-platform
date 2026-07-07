import { ForbiddenException } from '@nestjs/common';

/**
 * Distincte d'un `ForbiddenException` générique via le champ `error` de la réponse
 * JSON (`PASSWORD_CHANGE_REQUIRED`), pour que le frontend puisse détecter ce cas
 * précis de façon fiable (pas par correspondance de texte sur le message).
 */
export class PasswordChangeRequiredException extends ForbiddenException {
  constructor() {
    super({
      statusCode: 403,
      error: 'PASSWORD_CHANGE_REQUIRED',
      message: 'Vous devez changer votre mot de passe avant de continuer.',
    });
  }
}
