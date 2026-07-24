import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  ConflictError,
  InternalServerError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  UnprocessableEntityError,
} from 'openai';
import {
  genericMessageFor,
  type CategorizedProviderError,
} from './ai-provider-error-category';

/**
 * Catégorise une erreur levée par le SDK OpenAI (AI-06) — jamais exposée telle
 * quelle : uniquement `category` (usage interne/journalisation) et un message
 * générique sûr (voir ai-provider-error-category.ts). Aucun détail brut
 * (stack, corps de réponse HTTP, en-têtes, clé API) n'est jamais renvoyé.
 */
export function categorizeOpenAiError(err: unknown): CategorizedProviderError {
  if (err instanceof APIUserAbortError) {
    return { category: 'aborted', message: genericMessageFor('aborted') };
  }
  if (
    err instanceof AuthenticationError ||
    err instanceof PermissionDeniedError
  ) {
    return {
      category: 'authentication_error',
      message: genericMessageFor('authentication_error'),
    };
  }
  if (err instanceof RateLimitError) {
    return { category: 'rate_limit', message: genericMessageFor('rate_limit') };
  }
  if (err instanceof NotFoundError) {
    return {
      category: 'model_unavailable',
      message: genericMessageFor('model_unavailable'),
    };
  }
  if (
    err instanceof BadRequestError ||
    err instanceof UnprocessableEntityError ||
    err instanceof ConflictError
  ) {
    return {
      category: 'invalid_request',
      message: genericMessageFor('invalid_request'),
    };
  }
  if (err instanceof APIConnectionTimeoutError) {
    return { category: 'timeout', message: genericMessageFor('timeout') };
  }
  if (err instanceof APIConnectionError) {
    return {
      category: 'network_error',
      message: genericMessageFor('network_error'),
    };
  }
  if (err instanceof InternalServerError) {
    return {
      category: 'unknown_provider_error',
      message: genericMessageFor('unknown_provider_error'),
    };
  }
  return {
    category: 'unknown_provider_error',
    message: genericMessageFor('unknown_provider_error'),
  };
}
