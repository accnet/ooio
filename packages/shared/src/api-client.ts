/**
 * Shared browser API client used by apps/web, apps/ops and apps/admin.
 *
 * WHY THIS EXISTS: the three apps had three copies of this ~60 lines. Token
 * handling drifting between copies is how session bugs are born — one app fixes
 * a 401 edge case and the others silently keep the old behaviour.
 *
 * WHY IT IS A FACTORY: the apps must NOT share localStorage keys. If they ever
 * end up on the same origin, shared keys would let a customer session and an
 * operator session overwrite each other. Each app passes its own keys, so the
 * separation survives the de-duplication instead of being erased by it.
 */

export interface ApiErrorShape {
  message?: string | string[];
  error?: string;
  statusCode?: number;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface ApiClientOptions {
  /** localStorage key for the access token. MUST differ per app. */
  accessTokenKey: string;
  /** localStorage key for the refresh token. MUST differ per app. */
  refreshTokenKey: string;
  /** Prefix the dev server proxies to the API. Defaults to `/api`. */
  basePath?: string;
}

export interface ApiClient {
  request<T>(path: string, options?: RequestInit): Promise<T>;
  saveTokens(tokens: AuthTokens): void;
  clearTokens(): void;
  hasToken(): boolean;
  /** Reads a claim out of the JWT payload. Convenience only — never an authorization decision. */
  claimFromToken<T>(claim: string): T | null;
}

function errorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object') return fallback;
  const data = body as ApiErrorShape;
  if (Array.isArray(data.message)) return data.message.join(', ');
  return data.message || data.error || fallback;
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const { accessTokenKey, refreshTokenKey } = options;
  const basePath = options.basePath ?? '/api';

  if (accessTokenKey === refreshTokenKey) {
    throw new Error('accessTokenKey and refreshTokenKey must differ');
  }

  const getToken = (): string | null => localStorage.getItem(accessTokenKey);

  const clearTokens = (): void => {
    localStorage.removeItem(accessTokenKey);
    localStorage.removeItem(refreshTokenKey);
  };

  return {
    saveTokens(tokens: AuthTokens): void {
      localStorage.setItem(accessTokenKey, tokens.accessToken);
      localStorage.setItem(refreshTokenKey, tokens.refreshToken);
    },

    clearTokens,

    hasToken(): boolean {
      return Boolean(getToken());
    },

    claimFromToken<T>(claim: string): T | null {
      const token = getToken();
      if (!token) return null;
      try {
        const payload = token.split('.')[1];
        const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
        const decoded = JSON.parse(
          window.atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')),
        ) as Record<string, unknown>;
        return (decoded[claim] as T) ?? null;
      } catch {
        return null;
      }
    },

    async request<T>(path: string, init: RequestInit = {}): Promise<T> {
      const headers = new Headers(init.headers);
      headers.set('Accept', 'application/json');
      if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
      const token = getToken();
      if (token) headers.set('Authorization', `Bearer ${token}`);

      const response = await fetch(`${basePath}${path}`, { ...init, headers });
      const contentType = response.headers.get('content-type') || '';
      const body: unknown = contentType.includes('json') ? await response.json() : await response.text();

      if (!response.ok) {
        if (response.status === 401) {
          clearTokens();
          window.dispatchEvent(new Event('auth-expired'));
        }
        throw new ApiError(errorMessage(body, `Request failed (${response.status})`), response.status);
      }
      return body as T;
    },
  };
}
