import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';

/**
 * Résout le tracker de limitation de débit (AI-08) : identifie un utilisateur
 * authentifié par `user.id` plutôt que par IP, pour que deux utilisateurs
 * derrière la même adresse (poste partagé du laboratoire) ne partagent jamais
 * le même quota. `req.user` est déjà peuplé au moment où ce garde s'exécute :
 * `JwtAuthGuard` (garde global, voir AuthModule) s'exécute systématiquement
 * avant tout garde posé au niveau du contrôleur/de la méthode. Repli explicite
 * sur `req.ip` si `user` est exceptionnellement absent — jamais d'exception,
 * jamais de contournement silencieux de la limite (même comportement par
 * défaut que `ThrottlerGuard.getTracker` de base).
 *
 * Fonction pure exportée séparément pour être testée sans dépendre de Nest
 * ni du reste du garde (voir assistant-throttler.guard.spec.ts).
 */
export function resolveAssistantThrottleTracker(req: {
  user?: Pick<AuthenticatedUser, 'id'>;
  ip?: string;
}): string {
  return req.user?.id ?? req.ip ?? '';
}

/**
 * Sous-classe de `ThrottlerGuard` (voir `@nestjs/throttler`) : ne modifie que
 * l'identification du client (`getTracker`), rien d'autre. Réutilise
 * l'enregistrement global existant du module (voir AssistantModule et
 * AuthModule/SEC-02) — n'appelle jamais `ThrottlerModule.forRoot()` lui-même.
 * La limite/fenêtre effective de la route est fixée par `@Throttle(...)` sur
 * `AssistantController.streamMessage`, pas ici.
 */
@Injectable()
export class AssistantThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, any>): Promise<string> {
    return Promise.resolve(resolveAssistantThrottleTracker(req));
  }
}
