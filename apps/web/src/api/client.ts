import type { LoginRequest, LoginResponse, AuthenticatedUser } from '@lca-mes/shared';

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

interface ErrorBody {
  message?: string | string[];
}

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(path, { ...options, headers });

  if (!response.ok) {
    let message = `Erreur ${response.status}`;
    try {
      const body = (await response.json()) as ErrorBody;
      if (body.message) {
        message = Array.isArray(body.message) ? body.message.join(' ') : body.message;
      }
    } catch {
      // Corps de réponse non-JSON : on garde le message générique.
    }
    throw new ApiError(response.status, message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export const api = {
  login: (payload: LoginRequest): Promise<LoginResponse> =>
    request<LoginResponse>('/auth/login', { method: 'POST', body: JSON.stringify(payload) }),

  me: (token: string): Promise<AuthenticatedUser> => request<AuthenticatedUser>('/auth/me', {}, token),
};
