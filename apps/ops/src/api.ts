// Operator API client.
//
// The request/token plumbing now lives in packages/shared (the third consumer
// arrived, which was the documented trigger to extract it). Storage keys stay
// per-app: shared keys would let a customer session and an operator session
// overwrite each other if the apps ever share an origin.
import { ApiError, AuthTokens, createApiClient } from '@ooio/shared';

export { ApiError };
export type { AuthTokens };

export const ACCESS_TOKEN_KEY = 'ooio.ops.accessToken';
export const REFRESH_TOKEN_KEY = 'ooio.ops.refreshToken';

const client = createApiClient({
  accessTokenKey: ACCESS_TOKEN_KEY,
  refreshTokenKey: REFRESH_TOKEN_KEY,
});

export const saveTokens = client.saveTokens;
export const clearTokens = client.clearTokens;
export const hasToken = client.hasToken;
const request = client.request;

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


/**
 * Reads the legacy single-role claim. SA14 also emits `platformRoles` (array);
 * this app keeps reading the compatibility claim so operators are never locked
 * out of the console they would need in order to fix a rollout.
 *
 * CONVENIENCE ONLY — the authorization decision is PlatformRoleGuard on the API.
 */
export function platformRoleFromToken(): string | null {
  return client.claimFromToken<string>('platformRole');
}

export function isOperator(): boolean {
  return platformRoleFromToken() === 'operator';
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
