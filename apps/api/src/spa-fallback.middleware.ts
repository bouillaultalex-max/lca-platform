import { NextFunction, Request, Response } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const INDEX_HTML_PATH = join(__dirname, '..', 'public', 'index.html');

/**
 * Certaines routes React (ex: /catalog, /stock, /production, /dashboard, et même
 * /catalog/recipes, /catalog/machines) partagent le chemin littéral d'un préfixe
 * ou d'un endpoint d'API. Un filtrage par préfixe (exclude de ServeStaticModule)
 * ne peut pas lever cette ambiguïté : /catalog/recipes est à la fois une page
 * React et un vrai endpoint API (liste des recettes). Seul l'en-tête `Accept`
 * permet de distinguer une navigation de page (F5, saisie d'URL, lien externe —
 * envoie toujours `text/html` en priorité) d'un appel API réel (fetch du
 * frontend, qui ne l'envoie jamais) — même logique que `bypassPageNavigations`
 * côté proxy Vite en développement (apps/web/vite.config.ts).
 *
 * Ce middleware doit être enregistré avant ServeStaticModule (voir main.ts) :
 * toute navigation de page reçoit directement index.html, quel que soit le
 * chemin demandé, sans avoir à connaître à l'avance la liste des routes React.
 * /api/* (Swagger) et /health restent exclus car ce sont de vraies pages/réponses
 * non-SPA que le navigateur peut légitimement demander en HTML.
 * Sans effet en développement local : le build (dist/public/index.html) n'existe
 * pas, le frontend étant alors servi séparément par Vite sur son propre port.
 */
const NON_SPA_PREFIXES = ['/api', '/health'];

function isNonSpaPath(path: string): boolean {
  return NON_SPA_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

export function spaFallbackMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (
    req.method !== 'GET' ||
    !req.headers.accept?.includes('html') ||
    isNonSpaPath(req.path) ||
    !existsSync(INDEX_HTML_PATH)
  ) {
    next();
    return;
  }
  res.sendFile(INDEX_HTML_PATH, (err) => {
    if (err) next();
  });
}
