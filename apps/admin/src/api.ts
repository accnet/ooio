// Support console API client.
//
// Request/token plumbing comes from packages/shared. Storage keys stay per-app:
// shared keys would let a customer, operator or support session overwrite each
// other if these apps ever share an origin.
import { ApiError, AuthTokens, createApiClient } from '@ooio/shared';

export { ApiError };
export type { AuthTokens };

export const ACCESS_TOKEN_KEY = 'ooio.support.accessToken';
export const REFRESH_TOKEN_KEY = 'ooio.support.refreshToken';

const client = createApiClient({
  accessTokenKey: ACCESS_TOKEN_KEY,
  refreshTokenKey: REFRESH_TOKEN_KEY,
});

export const saveTokens = client.saveTokens;
export const clearTokens = client.clearTokens;
export const hasToken = client.hasToken;
const request = client.request;

export class SupportRoleError extends Error {
  constructor() {
    super('This console is limited to support users. Your account does not have the support role.');
    this.name = 'SupportRoleError';
  }
}

export interface Plan {
  id: string;
  name: string;
  slug: string;
  priceCents?: number;
  limits?: Record<string, unknown> | null;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan: Plan | null;
  storeCount: number;
  memberCount: number;
  ownerEmail: string | null;
  createdAt: string;
}

export interface Subscription {
  id: string;
  status: string;
  currentPeriodEnd?: string | null;
  createdAt?: string;
  plan: Plan;
}

export interface OrganizationDetail extends Organization {
  subscription: Subscription | null;
}

export interface StoreDomain {
  hostname: string;
  verified: boolean;
  tlsStatus: string;
}

export interface AdminStore {
  id: string;
  organizationId: string;
  externalId: string | null;
  status: string;
  tier: string | null;
  distribution: string | null;
  runtimeVer: string | null;
  createdAt: string;
  updatedAt: string;
  organization: { id: string; name: string; slug: string };
  domains: StoreDomain[];
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export type OrganizationPage = PageMeta & { organizations: Organization[] };
export type StorePage = PageMeta & { stores: AdminStore[] };

/**
 * CONVENIENCE ONLY — the authorization decision is PlatformRoleGuard on the API.
 * This just avoids rendering screens whose every request would return 403.
 */
export function platformRolesFromToken(): string[] {
  const roles = client.claimFromToken<unknown>('platformRoles');
  return Array.isArray(roles) ? roles.filter((role): role is string => typeof role === 'string') : [];
}

export function isSupport(): boolean {
  return platformRolesFromToken().includes('support');
}

export async function login(email: string, password: string): Promise<AuthTokens> {
  const tokens = await request<AuthTokens>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  saveTokens(tokens);
  if (!platformRolesFromToken().includes('support')) {
    clearTokens();
    throw new SupportRoleError();
  }
  return tokens;
}

export function getOrganizations(search: string, page: number, limit = 10): Promise<OrganizationPage> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (search.trim()) params.set('search', search.trim());
  return request<OrganizationPage>(`/admin/organizations?${params.toString()}`);
}

export function getOrganization(id: string): Promise<OrganizationDetail> {
  return request<OrganizationDetail>(`/admin/organizations/${encodeURIComponent(id)}`);
}

export function getStores(
  filters: { organizationId?: string; status?: string },
  page: number,
  limit = 10,
): Promise<StorePage> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (filters.organizationId) params.set('organizationId', filters.organizationId);
  if (filters.status) params.set('status', filters.status);
  return request<StorePage>(`/admin/stores?${params.toString()}`);
}
