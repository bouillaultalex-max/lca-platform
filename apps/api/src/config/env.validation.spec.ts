import { envValidationSchema, isWeakJwtSecret } from './env.validation';

const VALID_DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
// Générée pour les tests uniquement (aléatoire, 64 caractères hexadécimaux) — ne
// déclenche aucun des marqueurs de faiblesse, comme un vrai secret généré via
// `openssl rand -hex 32` ne le ferait pas non plus.
const STRONG_SECRET = '4f1c9b3e7a26d805f3b1c9e02a7d4f68b1c3e9a07d2f4b6c8e1a3d5f7b9c0e2a';

function validate(env: Record<string, unknown>) {
  return envValidationSchema.validate(
    { DATABASE_URL: VALID_DATABASE_URL, ...env },
    { abortEarly: false },
  );
}

describe('env.validation — isWeakJwtSecret', () => {
  it.each([
    'a-remplacer-par-une-valeur-forte-et-secrete',
    'A-REMPLACER-PAR-UNE-VALEUR-FORTE-ET-SECRETE',
    'test-secret-uniquement-changez-moi-vraiment',
    'your-256-bit-secretxxxxxxxxxxxxxxxxxxxxxxxx',
    'this-is-my-supersecretxxxxxxxxxxxxxxxxxxxxx',
    'password1234567890123456789012345678901234',
    'this-is-an-example-value-1234567890123456789',
    'ChangeMoi_JWT_Secret_2026_Tres_Long_Placeholder',
  ])('détecte %s comme faible/exemple', (value) => {
    expect(isWeakJwtSecret(value)).toBe(true);
  });

  it("n'est pas déclenché par un secret fort aléatoire", () => {
    expect(isWeakJwtSecret(STRONG_SECRET)).toBe(false);
  });
});

describe('env.validation — JWT_SECRET', () => {
  it('rejette une configuration sans JWT_SECRET', () => {
    const { error } = validate({});
    expect(error?.message).toMatch(/JWT_SECRET/);
  });

  it('rejette un JWT_SECRET vide', () => {
    const { error } = validate({ JWT_SECRET: '' });
    expect(error).toBeDefined();
  });

  it('rejette un JWT_SECRET trop court (< 32 caractères)', () => {
    const { error } = validate({ JWT_SECRET: 'a'.repeat(20) });
    expect(error?.message).toMatch(/32 caractères/);
  });

  it("rejette un JWT_SECRET manifestement faible ou d'exemple", () => {
    const { error } = validate({
      JWT_SECRET: 'a-remplacer-par-une-valeur-forte-et-secrete',
    });
    expect(error?.message).toMatch(/exemple|faible/);
  });

  it('accepte un JWT_SECRET conforme', () => {
    const { error, value } = validate({ JWT_SECRET: STRONG_SECRET });
    expect(error).toBeUndefined();
    expect(value.JWT_SECRET).toBe(STRONG_SECRET);
  });

  it('applique la même règle en production', () => {
    const weak = validate({ NODE_ENV: 'production', JWT_SECRET: 'a'.repeat(20) });
    expect(weak.error).toBeDefined();

    const strong = validate({ NODE_ENV: 'production', JWT_SECRET: STRONG_SECRET });
    expect(strong.error).toBeUndefined();
  });

  it("applique la même règle dans l'environnement de test — aucun contournement", () => {
    const weak = validate({ NODE_ENV: 'test', JWT_SECRET: 'a-remplacer-par-une-valeur-forte-et-secrete' });
    expect(weak.error).toBeDefined();

    const strong = validate({ NODE_ENV: 'test', JWT_SECRET: STRONG_SECRET });
    expect(strong.error).toBeUndefined();
  });

  it('le secret dédié de .env.test.example respecte la même règle, sans dérogation', () => {
    const { error } = validate({
      NODE_ENV: 'test',
      JWT_SECRET: 'test-secret-uniquement-pour-les-tests-automatises',
    });
    expect(error).toBeUndefined();
  });
});
