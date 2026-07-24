import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
} from 'openai';
import { categorizeOpenAiError } from './openai-error-mapper.util';

describe('categorizeOpenAiError', () => {
  it('catégorise une annulation SDK en "aborted"', () => {
    const result = categorizeOpenAiError(new APIUserAbortError());
    expect(result.category).toBe('aborted');
  });

  it('catégorise une erreur d’authentification (401) en "authentication_error"', () => {
    const result = categorizeOpenAiError(
      new AuthenticationError(401, {}, 'Unauthorized', new Headers()),
    );
    expect(result.category).toBe('authentication_error');
  });

  it('catégorise un accès refusé (403) en "authentication_error"', () => {
    const result = categorizeOpenAiError(
      new PermissionDeniedError(403, {}, 'Forbidden', new Headers()),
    );
    expect(result.category).toBe('authentication_error');
  });

  it('catégorise une limitation de débit (429) en "rate_limit"', () => {
    const result = categorizeOpenAiError(
      new RateLimitError(429, {}, 'Too Many Requests', new Headers()),
    );
    expect(result.category).toBe('rate_limit');
  });

  it('catégorise un modèle introuvable (404) en "model_unavailable"', () => {
    const result = categorizeOpenAiError(
      new NotFoundError(404, {}, 'Not Found', new Headers()),
    );
    expect(result.category).toBe('model_unavailable');
  });

  it('catégorise une requête invalide (400) en "invalid_request"', () => {
    const result = categorizeOpenAiError(
      new BadRequestError(400, {}, 'Bad Request', new Headers()),
    );
    expect(result.category).toBe('invalid_request');
  });

  it('catégorise un délai de connexion en "timeout"', () => {
    const result = categorizeOpenAiError(new APIConnectionTimeoutError());
    expect(result.category).toBe('timeout');
  });

  it('catégorise une erreur de connexion en "network_error"', () => {
    const result = categorizeOpenAiError(
      new APIConnectionError({ message: 'ECONNRESET' }),
    );
    expect(result.category).toBe('network_error');
  });

  it('catégorise une erreur serveur (5xx) en "unknown_provider_error"', () => {
    const result = categorizeOpenAiError(
      new InternalServerError(500, {}, 'Internal Server Error', new Headers()),
    );
    expect(result.category).toBe('unknown_provider_error');
  });

  it('catégorise toute erreur non reconnue en "unknown_provider_error"', () => {
    const result = categorizeOpenAiError(new Error('inattendu'));
    expect(result.category).toBe('unknown_provider_error');
  });

  it('ne renvoie jamais le message brut de l’erreur d’origine (toujours un message générique)', () => {
    const result = categorizeOpenAiError(
      new AuthenticationError(
        401,
        { message: 'sk-secret-detail-that-must-never-leak' },
        'Unauthorized',
        new Headers(),
      ),
    );
    expect(result.message).not.toContain(
      'sk-secret-detail-that-must-never-leak',
    );
  });
});
