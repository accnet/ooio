// Customer portal API client.
//
// Request/token plumbing comes from packages/shared. Storage keys stay per-app:
// shared keys would let a customer session and an operator or support session
// overwrite each other if these apps ever share an origin.
import { ApiError, AuthTokens, createApiClient } from '@ooio/shared';

export { ApiError };
export type { AuthTokens };

export const ACCESS_TOKEN_KEY = 'woocloud.accessToken';
export const REFRESH_TOKEN_KEY = 'woocloud.refreshToken';

const client = createApiClient({
  accessTokenKey: ACCESS_TOKEN_KEY,
  refreshTokenKey: REFRESH_TOKEN_KEY,
});

export const saveTokens = client.saveTokens;
export const clearTokens = client.clearTokens;
export const hasToken = client.hasToken;
const request = client.request;

export function organizationIdFromToken(): string | null {
  return client.claimFromToken<string>('organizationId');
}

export function emailFromToken(): string | null {
  return client.claimFromToken<string>('email');
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
