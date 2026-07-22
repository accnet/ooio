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
  tier?: string;
  title?: string | null;
  path?: string | null;
  distribution?: string | null;
  runtimeVer?: string | null;
  createdAt?: string;
  updatedAt?: string;
  domains?: StoreDomain[];
}

export interface StoreDomain {
  hostname: string;
  verified: boolean;
  tlsStatus: string;
}

export interface StoreOperationsResponse {
  operations: Operation[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
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

export type StoreActionType = 'backup-store' | 'issue-ssl' | 'delete-store';

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

export interface AnalyticsGrowthPoint {
  date: string;
  created: number;
}

export interface OperationAnalytics {
  total: number;
  succeeded: number;
  failed: number;
  successRate: number;
  failureRate: number;
}

export interface AnalyticsOverview {
  stores: Record<string, number>;
  operations: OperationAnalytics;
  growth: AnalyticsGrowthPoint[];
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  status?: string;
  role?: string;
  createdAt?: string;
}

export interface ApiKey {
  id: string;
  name: string;
  scopes?: unknown;
  lastUsedAt?: string | null;
  expiresAt?: string | null;
  createdAt?: string;
}

export interface CreatedApiKey {
  id: string;
  name: string;
  key: string;
  createdAt?: string;
}

export interface StoreAnalytics {
  from: string;
  to: string;
  totals: Record<string, number>;
  growth: AnalyticsGrowthPoint[];
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

function claimFromToken<T>(claim: string): T | null {
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
}

export function organizationIdFromToken(): string | null {
  return claimFromToken<string>('organizationId');
}

export function emailFromToken(): string | null {
  return claimFromToken<string>('email');
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

export interface RegisterInput {
  email: string;
  password: string;
  name?: string;
  organizationName?: string;
}

// The API signs the account in as part of registering, so this returns tokens
// rather than requiring a second round trip through /auth/login.
export function register(input: RegisterInput): Promise<AuthTokens> {
  return request<AuthTokens>('/auth/register', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getStores(): Promise<Store[]> {
  return request<Store[]>('/stores');
}

export function getOrganizations(): Promise<Organization[]> {
  return request<Organization[]>('/orgs');
}

export function getApiKeys(organizationId: string): Promise<ApiKey[]> {
  return request<ApiKey[]>(`/orgs/${encodeURIComponent(organizationId)}/api-keys`);
}

export function createApiKey(organizationId: string, name: string): Promise<CreatedApiKey> {
  return request<CreatedApiKey>(`/orgs/${encodeURIComponent(organizationId)}/api-keys`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export function revokeApiKey(organizationId: string, keyId: string): Promise<{ id: string; revoked: boolean }> {
  return request<{ id: string; revoked: boolean }>(
    `/orgs/${encodeURIComponent(organizationId)}/api-keys/${encodeURIComponent(keyId)}`,
    { method: 'DELETE' },
  );
}

export function getStore(id: string): Promise<Store> {
  return request<Store>(`/stores/${encodeURIComponent(id)}`);
}

export function getStoreOperations(id: string): Promise<StoreOperationsResponse> {
  return request<StoreOperationsResponse>(`/stores/${encodeURIComponent(id)}/operations`);
}

export function createStore(input: CreateStoreInput): Promise<CreateStoreResponse> {
  return request<CreateStoreResponse>('/stores', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function createStoreOperation(
  storeId: string,
  type: StoreActionType,
  payload?: Record<string, unknown>,
): Promise<Operation> {
  return request<Operation>(`/stores/${encodeURIComponent(storeId)}/operations`, {
    method: 'POST',
    body: JSON.stringify({ type, payload }),
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

export function getSubscription(organizationId: string): Promise<Subscription | null> {
  return request<Subscription | null>(`/orgs/${encodeURIComponent(organizationId)}/subscription`);
}

export function getAnalyticsOverview(): Promise<AnalyticsOverview> {
  return request<AnalyticsOverview>('/analytics/overview');
}

export function getStoreAnalytics(from: string, to: string): Promise<StoreAnalytics> {
  const params = new URLSearchParams({
    from: `${from}T00:00:00.000Z`,
    to: `${to}T23:59:59.999Z`,
  });
  return request<StoreAnalytics>(`/analytics/stores?${params.toString()}`);
}
