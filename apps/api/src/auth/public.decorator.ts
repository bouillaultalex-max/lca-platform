import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marque un endpoint comme accessible sans authentification.
 * `JwtAuthGuard` étant appliqué globalement (voir AppModule), tout endpoint
 * est protégé par défaut : ce décorateur est la seule façon d'exempter une route
 * (ex: POST /auth/login). Ce choix "sécurisé par défaut" évite d'oublier de
 * protéger un nouvel endpoint métier.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
