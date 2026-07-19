import { assertNotProduction } from '../prisma/seed';

/**
 * Garde-fou de `prisma/seed.ts` (voir audit sécurité SEC-01) : ce script crée un
 * compte à mot de passe par défaut codé en dur et ne doit jamais pouvoir s'exécuter
 * contre un environnement de production.
 */
describe('seed.ts — assertNotProduction', () => {
  it("lève une erreur explicite si NODE_ENV vaut 'production'", () => {
    expect(() => assertNotProduction('production')).toThrow(
      /ne doit jamais être exécuté avec NODE_ENV=production/,
    );
  });

  it("n'échoue pas pour 'development'", () => {
    expect(() => assertNotProduction('development')).not.toThrow();
  });

  it("n'échoue pas pour 'test'", () => {
    expect(() => assertNotProduction('test')).not.toThrow();
  });

  it("n'échoue pas si NODE_ENV est absent (undefined)", () => {
    expect(() => assertNotProduction(undefined)).not.toThrow();
  });
});
