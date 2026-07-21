export const ACCESS_TOKEN_KEY = 'woocloud.accessToken';
export const REFRESH_TOKEN_KEY = 'woocloud.refreshToken';

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

export interface Store {
  id: string;
  externalId?: string;
  status: string;
  clusterId?: string | null;
  nodeId?: string | null;
  createdAt?: string;
  domains?: Array<{ domain: string }>;
}

export interface CreateStoreInput {
  domain: string;
  path: string;
  title: string;
  adminEmail: string;
}

export interface CreateStoreResponse {
  storeId: string;
  operationId: string;
  status: string;
}

export interface Operation {
  id: string;
  type: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' | string;
  progress?: number;
  error?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface Plan {
  id: string;
  slug: string;
  name: string;
  priceCents: number;
  limits?: { maxStores?: number } | null;
}

export interface Usage {
  stores: { used: number; limit: number };
  plan: string;
}

export interface Subscription {
  id: string;
  status: string;
  periodEnd?: string | null;
  plan: Plan;
}

export interface Cluster {
  id: string;
  name: string;
  region?: string;
  status?: string;
  nodes?: Array<{ id: string; hostname?: string; status?: string; capacity?: Record<string, unknown> }>;
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

export function organizationIdFromToken(): string | null {
  const token = getToken();
  if (!token) return null;

  try {
    const payload = token.split('.')[1];
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(window.atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='))) as { organizationId?: string };
    return decoded.organizationId ?? null;
  } catch {
    return null;
  }
}

function errorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object') return fallback;
  const data = body as ApiErrorShape;
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

export function getStores(): Promise<Store[]> {
  return request<Store[]>('/stores');
}

export function createStore(input: CreateStoreInput): Promise<CreateStoreResponse> {
  return request<CreateStoreResponse>('/stores', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getOperation(id: string): Promise<Operation> {
  return request<Operation>(`/operations/${encodeURIComponent(id)}`);
}

export function getPlans(): Promise<Plan[]> {
  return request<Plan[]>('/plans');
}

export function getUsage(organizationId: string): Promise<Usage> {
  return request<Usage>(`/orgs/${encodeURIComponent(organizationId)}/usage`);
}

export function changeSubscription(organizationId: string, planId: string): Promise<Subscription> {
  return request<Subscription>(`/orgs/${encodeURIComponent(organizationId)}/subscription`, {
    method: 'POST',
    body: JSON.stringify({ planId }),
  });
}

export async function getClusters(): Promise<Cluster[] | null> {
  try {
    const data = await request<Cluster[] | { clusters?: Cluster[] }>('/clusters');
    return Array.isArray(data) ? data : data.clusters ?? [];
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}
