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

function rejectWeakJwtSecret(
  value: string,
  helpers: Joi.CustomHelpers<string>,
) {
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

// AI_BASE_URL (AI-06) : jamais une donnée utilisateur (variable d'environnement
// contrôlée par l'exploitant), mais une hygiène de configuration minimale reste
// utile — https systématiquement autorisé, http uniquement vers une passerelle
// locale (localhost/127.0.0.1), refusé pour tout autre hôte.
function restrictAiBaseUrl(value: string, helpers: Joi.CustomHelpers<string>) {
  if (value === '') return value;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return helpers.message({ custom: 'AI_BASE_URL doit être une URL valide.' });
  }

  const isHttps = parsed.protocol === 'https:';
  const isLocalHttp =
    parsed.protocol === 'http:' &&
    (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1');
  if (isHttps || isLocalHttp) return value;

  return helpers.message({
    custom:
      'AI_BASE_URL doit utiliser https, ou http uniquement vers localhost/127.0.0.1 ' +
      '(passerelle locale) — refusé pour tout autre hôte en http.',
  });
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
      'string.min':
        'JWT_SECRET doit contenir au moins 32 caractères (ex: `openssl rand -hex 32`).',
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

  // Sélecteur de fournisseur IA (AI-06, voir AssistantModule) : seul point de
  // décision de toute l'application — jamais un if/else dispersé ailleurs.
  // `echo` reste la valeur par défaut sûre (dev/test), aucun repli silencieux
  // vers `echo` si `openai` est sélectionné mais mal configuré (échec net
  // au démarrage via les règles conditionnelles ci-dessous).
  AI_PROVIDER: Joi.string().valid('echo', 'openai').default('echo'),
  // Obligatoire uniquement si AI_PROVIDER=openai — jamais lue directement via
  // process.env ailleurs que dans la factory NestJS (voir AssistantModule).
  AI_API_KEY: Joi.string().when('AI_PROVIDER', {
    is: 'openai',
    then: Joi.string().min(1).required().messages({
      'any.required':
        'AI_API_KEY est obligatoire quand AI_PROVIDER=openai (voir .env.example).',
      'string.empty': 'AI_API_KEY est obligatoire quand AI_PROVIDER=openai.',
    }),
    otherwise: Joi.string().allow('').optional(),
  }),
  // Passerelle personnalisée (proxy d'entreprise, self-hosted compatible OpenAI,
  // ex: vLLM/LiteLLM) — optionnelle quel que soit AI_PROVIDER. Voir
  // restrictAiBaseUrl : https systématiquement autorisé, http uniquement vers
  // localhost/127.0.0.1.
  AI_BASE_URL: Joi.string()
    .allow('')
    .optional()
    .custom(
      restrictAiBaseUrl,
      'restriction de AI_BASE_URL aux hôtes autorisés',
    ),
  // Organisation/projet OpenAI — optionnels, sans effet pour les autres valeurs
  // de AI_PROVIDER (jamais lus ni requis en dehors du cas openai).
  AI_ORGANIZATION: Joi.string().allow('').optional(),
  AI_PROJECT: Joi.string().allow('').optional(),
  // Nom du modèle, jamais codé en dur dans l'orchestrateur (voir AssistantService) —
  // obligatoire quand AI_PROVIDER=openai (un modèle réel doit être choisi
  // explicitement), défaut `stub-echo` sinon.
  AI_MODEL: Joi.string()
    .min(1)
    .when('AI_PROVIDER', {
      is: 'openai',
      then: Joi.required().messages({
        'any.required': 'AI_MODEL est obligatoire quand AI_PROVIDER=openai.',
      }),
      otherwise: Joi.optional().default('stub-echo'),
    }),
  // Délai maximal (ms) accordé à une génération complète avant abandon explicite.
  AI_REQUEST_TIMEOUT_MS: Joi.number().integer().positive().default(30000),
  // Limite de tokens de sortie transmise au fournisseur (non appliquée par
  // EchoAiProvider, qui ne génère pas de tokens réels — voir AI-02).
  AI_MAX_OUTPUT_TOKENS: Joi.number().integer().positive().default(1024),

  // Tool calling (AI-04, voir ToolCallingOrchestrator) — trois garde-fous
  // structurels indépendants contre une boucle de raisonnement infinie, chacun
  // vérifié séparément : un fournisseur défaillant ne peut dépasser aucun des
  // trois, quel que soit son comportement.
  // Nombre total d'appels d'outils pour un même message utilisateur, tous tours confondus.
  AI_MAX_TOOL_CALLS: Joi.number().integer().positive().default(10),
  // Nombre de tours (aller-retours complets avec le fournisseur) pour un même message.
  AI_MAX_TOOL_CALL_TURNS: Joi.number().integer().positive().default(5),
  // Profondeur maximale d'imbrication de la boucle de tool calling (récursion de
  // ToolCallingOrchestrator) — configurable indépendamment de AI_MAX_TOOL_CALL_TURNS.
  AI_MAX_TOOL_CALL_DEPTH: Joi.number().integer().positive().default(5),

  // Context Engine (AI-05, voir ContextEngine) — budget de préparation du
  // contexte envoyé au fournisseur, indépendant des limites de tool calling
  // ci-dessus (qui bornent le nombre de tours/appels, pas la taille du contexte).
  // Estimation maximale de jetons (voir context/token-estimator.util.ts, aucun
  // tokenizer réel) pour l'ensemble system + contexte statique + résumé éventuel
  // + historique conservé + nouveau message utilisateur.
  AI_CONTEXT_MAX_TOKENS: Joi.number().integer().positive().default(8000),
  // Nombre maximal de messages transmis au fournisseur, tous rôles confondus.
  AI_CONTEXT_MAX_MESSAGES: Joi.number().integer().positive().default(40),
  // Taille maximale (caractères) d'un message individuel transmis — au-delà,
  // troncature explicite (voir context/truncate-message.util.ts), jamais une
  // suppression silencieuse.
  AI_CONTEXT_MAX_MESSAGE_CHARS: Joi.number().integer().positive().default(4000),
  // Nombre minimal de messages historiques récents en dessous duquel un résumé
  // déterministe (voir context/conversation-summary.util.ts) remplace la simple
  // troncature silencieuse des messages plus anciens.
  AI_CONTEXT_RECENT_MESSAGES_MIN: Joi.number().integer().min(0).default(6),
});
