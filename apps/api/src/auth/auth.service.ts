import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

export interface AuthenticatedUser {
  userId?: string;
  email?: string;
  organizationId: string;
  platformRoles: string[];
  platformRole?: string | null;
  authType: 'jwt' | 'api-key';
  apiKeyId?: string;
  scopes?: string[];
}

export interface AuthenticatedRequest {
  user: AuthenticatedUser;
}

export interface RegisterInput {
  email: string;
  password: string;
  name?: string;
  organizationName?: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
}

export interface JwtPayload {
  sub: string;
  email: string;
  organizationId: string;
  platformRoles: string[];
  platformRole?: string | null;
  tokenType: 'access' | 'refresh';
}

interface UserRecord {
  id: string;
  email: string;
  passwordHash?: string | null;
  platformRoles?: unknown;
  memberships: Array<{ organizationId: string }>;
}

interface UserDelegate {
  create(args: { data: Record<string, unknown> }): Promise<UserRecord>;
  findMany(args: {
    where: { email: { in: string[] } };
  }): Promise<UserRecord[]>;
  update(args: {
    where: { id: string };
    data: { platformRoles: string[] };
  }): Promise<UserRecord>;
}

interface UserClient {
  user: UserDelegate;
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function generateApiKey(): string {
  return `wk_${randomBytes(32).toString('base64url')}`;
}

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly jwtSecret: string;
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {
    this.jwtSecret = config.get<string>('JWT_SECRET') || 'development-only-change-me';
  }

  async onModuleInit(): Promise<void> {
    const operatorEmails = this.operatorEmails();
    if (operatorEmails.length === 0) {
      this.logger.error(
        'No operator account is configured: the platform has no operator account, and no operator can be created via the API. Set PLATFORM_OPERATOR_EMAILS and restart the API.',
      );
      return;
    }

    const roleByEmail = this.bootstrapRolesByEmail();
    const emails = [...roleByEmail.keys()];

    // Bootstrap roles from configuration; request input can never grant a platform role.
    const users = await (this.prisma as unknown as UserClient).user.findMany({
      where: { email: { in: emails } },
    });
    const configuredOperatorEmails = new Set(operatorEmails);
    let matchedOperators = 0;
    for (const user of users) {
      const configuredRoles = roleByEmail.get(user.email) || [];
      const currentRoles = this.platformRoles(user);
      const nextRoles = [...new Set([...currentRoles, ...configuredRoles])];
      if (nextRoles.length !== currentRoles.length || nextRoles.some((role) => !currentRoles.includes(role))) {
        await (this.prisma as unknown as UserClient).user.update({
          where: { id: user.id },
          data: { platformRoles: nextRoles },
        });
      }
      if (configuredOperatorEmails.has(user.email)) {
        matchedOperators += 1;
      }
    }
    if (matchedOperators === 0) {
      this.logger.error(
        'No operator account matches PLATFORM_OPERATOR_EMAILS: the platform has no operator account, and no operator can be created via the API. Set PLATFORM_OPERATOR_EMAILS to an existing user email and restart the API, or update platform_roles directly in the database.',
      );
      return;
    }
    this.logger.log(`platform role bootstrap matched ${matchedOperators} operator user(s)`);
  }

  async register(input: RegisterInput): Promise<TokenResponse> {
    const email = input.email.trim().toLowerCase();
    if (!email || !input.password?.trim()) {
      throw new Error('email and password are required');
    }
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('email is already registered');
    }

    const passwordHash = await hash(input.password, 12);
    const organizationName = input.organizationName?.trim() || `${input.name?.trim() || email} organization`;
    const organizationSlug = `${this.slugify(organizationName)}-${randomBytes(4).toString('hex')}`;
    const result = await this.prisma.$transaction(async (tx) => {
      const configuredPlan = this.config.get<string>('DEFAULT_PLAN', 'free')?.trim().toLowerCase();
      const defaultPlanSlug = configuredPlan && ['free', 'pro', 'enterprise'].includes(configuredPlan)
        ? configuredPlan
        : 'free';
      const defaultPlan = await tx.plan.findUnique({ where: { slug: defaultPlanSlug } });
      const user = await (tx as unknown as UserClient).user.create({
        data: {
          email,
          name: input.name?.trim() || undefined,
          passwordHash,
          platformRoles: this.rolesForEmail(email),
        },
      });
      const organization = await tx.organization.create({
        data: { name: organizationName, slug: organizationSlug, planId: defaultPlan?.id },
      });
      await tx.membership.create({
        data: { organizationId: organization.id, userId: user.id, role: 'owner' },
      });
      return { user, organization };
    });

    return this.issueTokens({
      userId: result.user.id,
      email: result.user.email,
      organizationId: result.organization.id,
      platformRoles: this.platformRoles(result.user),
    });
  }

  async login(input: LoginInput): Promise<TokenResponse> {
    const email = input.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { memberships: { orderBy: { createdAt: 'asc' }, take: 1 } },
    }) as unknown as UserRecord | null;
    if (!user?.passwordHash || !(await compare(input.password, user.passwordHash))) {
      throw new UnauthorizedException('invalid email or password');
    }
    const membership = user.memberships[0];
    if (!membership) {
      throw new UnauthorizedException('user has no organization membership');
    }
    return this.issueTokens({
      userId: user.id,
      email: user.email,
      organizationId: membership.organizationId,
      platformRoles: this.platformRoles(user),
    });
  }

  async refresh(refreshToken: string): Promise<TokenResponse> {
    if (!refreshToken?.trim()) {
      throw new UnauthorizedException('refreshToken is required');
    }
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(refreshToken, { secret: this.jwtSecret });
    } catch {
      throw new UnauthorizedException('invalid refresh token');
    }
    if (payload.tokenType !== 'refresh' || !payload.sub) {
      throw new UnauthorizedException('invalid refresh token');
    }
    const context = await this.contextForUserId(payload.sub);
    if (!context) {
      throw new UnauthorizedException('user no longer exists');
    }
    return this.issueTokens({
      userId: context.userId as string,
      email: context.email as string,
      organizationId: context.organizationId,
      platformRoles: context.platformRoles,
    });
  }

  async contextForUserId(userId: string): Promise<AuthenticatedUser | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { memberships: { orderBy: { createdAt: 'asc' }, take: 1 } },
    }) as unknown as UserRecord | null;
    const membership = user?.memberships[0];
    if (!user || !membership) {
      return null;
    }
    return {
      userId: user.id,
      email: user.email,
      organizationId: membership.organizationId,
      platformRoles: this.platformRoles(user),
      platformRole: this.compatibilityRole(this.platformRoles(user)),
      authType: 'jwt',
    };
  }

  async validateApiKey(rawKey: string): Promise<AuthenticatedUser | null> {
    const key = await this.prisma.apiKey.findUnique({ where: { keyHash: hashApiKey(rawKey) } });
    if (!key || (key.expiresAt && key.expiresAt <= new Date())) {
      return null;
    }
    await this.prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
    const scopes = Array.isArray(key.scopes)
      ? key.scopes.filter((scope): scope is string => typeof scope === 'string')
      : undefined;
    return {
      organizationId: key.organizationId,
      platformRoles: [],
      platformRole: null,
      authType: 'api-key',
      apiKeyId: key.id,
      scopes,
    };
  }

  private async issueTokens(context: {
    userId: string;
    email: string;
    organizationId: string;
    platformRoles: string[];
  }): Promise<TokenResponse> {
    const base = {
      sub: context.userId,
      email: context.email,
      organizationId: context.organizationId,
      platformRoles: context.platformRoles,
      // Compatibility claim for clients that still read the singular field.
      platformRole: this.compatibilityRole(context.platformRoles),
    };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync({ ...base, tokenType: 'access' }, { secret: this.jwtSecret, expiresIn: 900 }),
      this.jwt.signAsync({ ...base, tokenType: 'refresh' }, { secret: this.jwtSecret, expiresIn: 604800 }),
    ]);
    return { accessToken, refreshToken };
  }

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'organization';
  }

  private operatorEmails(): string[] {
    return this.configuredEmails('PLATFORM_OPERATOR_EMAILS');
  }

  private supportEmails(): string[] {
    return this.configuredEmails('PLATFORM_SUPPORT_EMAILS');
  }

  private configuredEmails(key: string): string[] {
    return (this.config.get<string>(key) || '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean);
  }

  private bootstrapRolesByEmail(): Map<string, string[]> {
    const rolesByEmail = new Map<string, string[]>();
    for (const [role, emails] of [
      ['operator', this.operatorEmails()] as const,
      ['support', this.supportEmails()] as const,
    ]) {
      for (const email of emails) {
        const roles = rolesByEmail.get(email) || [];
        if (!roles.includes(role)) {
          roles.push(role);
        }
        rolesByEmail.set(email, roles);
      }
    }
    return rolesByEmail;
  }

  private rolesForEmail(email: string): string[] {
    return this.bootstrapRolesByEmail().get(email) || [];
  }

  private platformRoles(user: UserRecord): string[] {
    const roles = Array.isArray(user.platformRoles)
      ? user.platformRoles.filter((role): role is string => typeof role === 'string')
      : [];
    return [...new Set(roles)];
  }

  private compatibilityRole(roles: string[]): string | null {
    return roles.includes('operator') ? 'operator' : null;
  }
}
