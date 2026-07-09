import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Version de l'application, lue depuis `package.json` (jamais dupliquée en dur) —
 * utilisée pour figer le contexte applicatif dans chaque `Feedback` au moment du
 * signalement, afin de rester compréhensible en le relisant bien plus tard.
 */
export const APP_VERSION: string = (() => {
  try {
    const packageJsonPath = join(__dirname, '..', '..', 'package.json');
    const { version } = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as {
      version: string;
    };
    return version;
  } catch {
    return 'inconnue';
  }
})();
