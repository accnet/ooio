// Operator API client.
//
// Deliberately separate from apps/web/src/api.ts rather than shared through a
// package: the repo has no npm workspaces yet, so a shared package would be a
// bigger change than the split itself. The duplicated part is the ~60 lines of
// request/token plumbing below. Extract it to packages/shared when a THIRD
// consumer appears, or the moment the two copies start to drift — whichever is
// first. Token handling drifting between apps is how session bugs happen.

// Different storage keys from apps/web on purpose. If the two apps are ever
// served from the same origin, shared keys would let a customer session and an
// operator session overwrite each other.
export const ACCESS_TOKEN_KEY = 'ooio.admin.accessToken';
export const REFRESH_TOKEN_KEY = 'ooio.admin.refreshToken';

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

export interface Pool {
  id: string;
  clusterId: string;
  name: string;
  status: string;
  capacity: number;
  used: number;
}

export interface Distribution {
  id: string;
  name: string;
  version: string;
  channel: string;
  status: string;
  artifactUrl?: string;
  checksum?: string;
}

export interface FeatureFlag {
  key: string;
  description?: string | null;
  enabled: boolean;
  rules?: Record<string, unknown> | null;
}

export interface PlatformEvent {
  id: string;
  type: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  occurredAt: string;
  publishedAt: string | null;
  attempts: number;
  lastError: string | null;
}

export interface Paged<T> {
  events: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface NodeCapacity {
  cpuPercent?: number;
  memoryPercent?: number;
  diskPercent?: number;
  siteCount?: number;
  [key: string]: unknown;
}

export interface CapacityNode {
  id: string;
  hostname: string;
  status: string;
  health: string | null;
  capacity: NodeCapacity;
  lastHeartbeatAt: string | null;
}

export interface CapacityCluster {
  id: string;
  name: string;
  region: string;
  status: string;
  nodes: CapacityNode[];
}

export interface AnalyticsOverview {
  capacity?: CapacityCluster[];
}

function getToken(): string | null {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function saveTokens(tokens: AuthTokens): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
}

export function clearTokens(): void {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

export function hasToken(): boolean {
  return Boolean(getToken());
}

/**
 * Reads platformRole out of the JWT so the UI can avoid showing operator screens
 * to a customer account. This is a CONVENIENCE ONLY — the real check lives in
 * PlatformRoleGuard on the API. Never treat this as the authorization decision;
 * a hidden button is not a permission.
 */
export function platformRoleFromToken(): string | null {
  const token = getToken();
  if (!token) return null;
  try {
    const payload = token.split('.')[1];
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(
      window.atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')),
    ) as { platformRole?: string | null };
    return decoded.platformRole ?? null;
  } catch {
    return null;
  }
}

export function isOperator(): boolean {
  return platformRoleFromToken() === 'operator';
}

function errorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object') return fallback;
  const data = body as { message?: string | string[]; error?: string };
  if (Array.isArray(data.message)) return data.message.join(', ');
  return data.message || data.error || fallback;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(`/api${path}`, { ...options, headers });
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
}

export function login(email: string, password: string): Promise<AuthTokens> {
  return request<AuthTokens>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export function getPools(): Promise<Pool[]> {
  return request<Pool[]>('/pools');
}

export function setPoolStatus(id: string, status: string): Promise<Pool> {
  return request<Pool>(`/pools/${encodeURIComponent(id)}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export function getDistributions(): Promise<Distribution[]> {
  return request<Distribution[]>('/distributions');
}

export function publishDistribution(id: string): Promise<Distribution> {
  return request<Distribution>(`/distributions/${encodeURIComponent(id)}/publish`, { method: 'POST' });
}

export function getFlags(): Promise<FeatureFlag[]> {
  return request<FeatureFlag[]>('/flags');
}

export function setFlag(key: string, enabled: boolean): Promise<FeatureFlag> {
  return request<FeatureFlag>(`/flags/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({ enabled }),
  });
}

export function getEvents(limit = 50): Promise<Paged<PlatformEvent>> {
  return request<Paged<PlatformEvent>>(`/events?limit=${limit}`);
}

export function getAnalyticsOverview(): Promise<AnalyticsOverview> {
  return request<AnalyticsOverview>('/analytics/overview');
}
