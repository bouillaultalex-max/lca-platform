import * as Joi from 'joi';

/**
 * Schéma de validation des variables d'environnement.
 * L'application refuse de démarrer si une variable requise est absente ou invalide :
 * mieux vaut un échec explicite au démarrage qu'un comportement incorrect en silence.
 */

// Fragments (comparaison insensible à la casse) identifiant une valeur JWT_SECRET
// manifestement faible ou d'exemple — même si elle respecte la longueur minimale.
// Une longueur suffisante ne suffit pas : copier tel quel un placeholder documenté
// (ex: .env.example, README) ne doit jamais permettre de démarrer l'application.
// Inclut notamment les valeurs illustratives déjà présentes dans ce dépôt
// (.env.example à la racine et dans apps/api, tous deux au même contenu), ainsi que
// quelques défauts génériques bien connus (dont le secret d'exemple de jwt.io).
const WEAK_JWT_SECRET_MARKERS = [
  'a-remplacer-par-une-valeur-forte-et-secrete',
  'changez-moi',
  'change-me',
  'changeme',
  'changemoi',
  'remplacer',
  'your-256-bit-secret',
  'secret-key',
  'supersecret',
  'password',
  '123456',
  'qwerty',
  'example',
] as const;

export function isWeakJwtSecret(secret: string): boolean {
  const normalized = secret.toLowerCase();
  return WEAK_JWT_SECRET_MARKERS.some((marker) => normalized.includes(marker));
}

function rejectWeakJwtSecret(value: string, helpers: Joi.CustomHelpers<string>) {
  if (isWeakJwtSecret(value)) {
    return helpers.message({
      custom:
        "JWT_SECRET utilise une valeur d'exemple ou manifestement faible (ex: un placeholder " +
        'copié depuis .env.example). Générez une valeur forte et unique, par exemple avec ' +
        '`openssl rand -hex 32`.',
    });
  }
  return value;
}

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgresql', 'postgres'] })
    .required(),
  JWT_SECRET: Joi.string()
    .min(32)
    .required()
    .custom(rejectWeakJwtSecret, 'rejet des secrets JWT faibles ou d’exemple')
    .messages({
      'string.min': 'JWT_SECRET doit contenir au moins 32 caractères (ex: `openssl rand -hex 32`).',
      'string.empty': 'JWT_SECRET est obligatoire et ne peut pas être vide.',
      'any.required':
        'JWT_SECRET est obligatoire : définissez une valeur forte et unique dans .env (voir .env.example).',
    }),
  // Durée de validité du token, en secondes (28800 = 8h). Un nombre plutôt qu'une
  // chaîne ("8h") pour rester un type simple (number) côté JwtModule, sans dépendre
  // du type "StringValue" interne au package `ms`.
  JWT_EXPIRES_IN_SECONDS: Joi.number().integer().positive().default(28800),
  // Webhook Make du système de retours (voir FeedbackWebhookService) : optionnelle,
  // le système de retours fonctionne normalement si elle est absente. Une chaîne
  // vide (ligne présente mais non renseignée, cas courant en copiant .env.example)
  // est traitée exactement comme une variable absente, jamais comme une erreur.
  MAKE_FEEDBACK_WEBHOOK_URL: Joi.string().uri().allow('').optional(),
});
