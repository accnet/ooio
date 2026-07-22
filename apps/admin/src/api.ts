export const ACCESS_TOKEN_KEY = 'ooio.support.accessToken';
export const REFRESH_TOKEN_KEY = 'ooio.support.refreshToken';

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export class SupportRoleError extends Error {
  constructor() {
    super('This console is limited to support users. Your account does not have the support role.');
    this.name = 'SupportRoleError';
  }
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
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

export function platformRolesFromToken(): string[] {
  const token = getToken();
  if (!token) return [];
  try {
    const payload = token.split('.')[1];
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(
      window.atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')),
    ) as { platformRoles?: unknown };
    return Array.isArray(decoded.platformRoles)
      ? decoded.platformRoles.filter((role): role is string => typeof role === 'string')
      : [];
  } catch {
    return [];
  }
}

export function isSupport(): boolean {
  return platformRolesFromToken().includes('support');
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
