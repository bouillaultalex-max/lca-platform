import * as Joi from 'joi';

/**
 * Schéma de validation des variables d'environnement.
 * L'application refuse de démarrer si une variable requise est absente ou invalide :
 * mieux vaut un échec explicite au démarrage qu'un comportement incorrect en silence.
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgresql', 'postgres'] })
    .required(),
  JWT_SECRET: Joi.string().min(16).required(),
  // Durée de validité du token, en secondes (28800 = 8h). Un nombre plutôt qu'une
  // chaîne ("8h") pour rester un type simple (number) côté JwtModule, sans dépendre
  // du type "StringValue" interne au package `ms`.
  JWT_EXPIRES_IN_SECONDS: Joi.number().integer().positive().default(28800),
});
