import { Injectable } from '@nestjs/common';

/**
 * Horloge injectable (AI-05) : le Context Engine ne doit jamais appeler
 * `new Date()` directement (voir static-context.util.ts), pour rester
 * déterministe et testable sans dépendre de l'heure réelle de la machine.
 */
export interface Clock {
  now(): Date;
}

@Injectable()
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export const ASSISTANT_CLOCK = Symbol('ASSISTANT_CLOCK');
