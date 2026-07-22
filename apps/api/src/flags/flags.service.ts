import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  FeatureFlagEvaluationQuery,
  FeatureFlagRules,
  UpsertFeatureFlagInput,
} from './flag.types';

export interface FeatureFlagRecord {
  key: string;
  description: string | null;
  enabled: boolean;
  rules: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
}

interface FeatureFlagDelegate {
  findMany(args?: { orderBy?: Record<string, string> }): Promise<FeatureFlagRecord[]>;
  findUnique(args: { where: { key: string } }): Promise<FeatureFlagRecord | null>;
  create(args: { data: Record<string, unknown> }): Promise<FeatureFlagRecord>;
  update(args: { where: { key: string }; data: Record<string, unknown> }): Promise<FeatureFlagRecord>;
}

interface OrganizationDelegate {
  findUnique(args: { where: { id: string }; include?: { plan: boolean } }): Promise<{
    id: string;
    plan?: { slug: string } | null;
  } | null>;
}

interface FlagsPrisma {
  featureFlag: FeatureFlagDelegate;
  organization: OrganizationDelegate;
}

@Injectable()
export class FlagsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<FeatureFlagRecord[]> {
    return this.db().featureFlag.findMany({ orderBy: { key: 'asc' } });
  }

  async upsert(key: string, input: UpsertFeatureFlagInput): Promise<FeatureFlagRecord> {
    this.validateKey(key);
    this.validateInput(input);
    const existing = await this.db().featureFlag.findUnique({ where: { key } });
    const data: Record<string, unknown> = {};
    if (input.description !== undefined) {
      data.description = input.description?.trim() || null;
    }
    if (input.enabled !== undefined) {
      data.enabled = input.enabled;
    }
    if (input.rules !== undefined) {
      data.rules = input.rules as unknown as Prisma.InputJsonValue;
    }

    if (existing) {
      return Object.keys(data).length > 0
        ? this.db().featureFlag.update({ where: { key }, data })
        : existing;
    }

    return this.db().featureFlag.create({
      data: {
        key,
        description: input.description?.trim() || null,
        enabled: input.enabled ?? false,
        rules: (input.rules || {}) as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async evaluate(query: FeatureFlagEvaluationQuery, organizationId: string) {
    const scopedQuery = { ...query, orgId: organizationId };
    const flags = scopedQuery.key
      ? [await this.get(scopedQuery.key)]
      : await this.list();
    const planSlug = await this.planSlug(organizationId);
    return flags.map((flag) => this.evaluateOne(flag, scopedQuery, planSlug));
  }

  async get(key: string): Promise<FeatureFlagRecord> {
    const flag = await this.db().featureFlag.findUnique({ where: { key } });
    if (!flag) {
      throw new NotFoundException('feature flag not found');
    }
    return flag;
  }

  private evaluateOne(
    flag: FeatureFlagRecord,
    query: FeatureFlagEvaluationQuery,
    planSlug: string | null,
  ) {
    const rules = this.rules(flag.rules);
    let enabled = flag.enabled;
    let source = 'global';

    // Fixed precedence for rollout scopes is org > plan > cluster > global default.
    // Version is an optional selector evaluated only when those scopes do not match.
    const orgValue = this.ruleValue(rules.org, query.orgId);
    const planValue = this.ruleValue(rules.plan, planSlug);
    const clusterValue = this.ruleValue(rules.cluster, query.clusterId);
    const versionValue = this.ruleValue(rules.version, query.version);
    if (orgValue !== undefined) {
      enabled = orgValue;
      source = 'org';
    } else if (planValue !== undefined) {
      enabled = planValue;
      source = 'plan';
    } else if (clusterValue !== undefined) {
      enabled = clusterValue;
      source = 'cluster';
    } else if (versionValue !== undefined) {
      enabled = versionValue;
      source = 'version';
    } else if (typeof rules.default === 'boolean') {
      enabled = rules.default;
      source = 'global';
    }

    return {
      key: flag.key,
      enabled,
      source,
      organizationId: query.orgId || null,
      clusterId: query.clusterId || null,
      plan: planSlug,
      version: query.version || null,
    };
  }

  private async planSlug(organizationId?: string): Promise<string | null> {
    if (!organizationId) {
      return null;
    }
    const organization = await this.db().organization.findUnique({
      where: { id: organizationId },
      include: { plan: true },
    });
    if (!organization) {
      throw new NotFoundException('organization not found');
    }
    return organization.plan?.slug || null;
  }

  private rules(value: Prisma.JsonValue): FeatureFlagRules {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    return value as FeatureFlagRules;
  }

  private ruleValue(
    values: Record<string, boolean | { enabled: boolean }> | undefined,
    key: string | null | undefined,
  ): boolean | undefined {
    if (!values || !key || !(key in values)) {
      return undefined;
    }
    const value = values[key];
    if (typeof value === 'boolean') {
      return value;
    }
    return value && typeof value === 'object' && typeof value.enabled === 'boolean'
      ? value.enabled
      : undefined;
  }

  private validateKey(key: string): void {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(key)) {
      throw new Error('feature flag key must be 1-128 characters using letters, numbers, dot, underscore, or hyphen');
    }
  }

  private validateInput(input: UpsertFeatureFlagInput): void {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new Error('feature flag input must be an object');
    }
    if (input.enabled !== undefined && typeof input.enabled !== 'boolean') {
      throw new Error('enabled must be a boolean');
    }
    if (input.rules !== undefined && (!input.rules || typeof input.rules !== 'object' || Array.isArray(input.rules))) {
      throw new Error('rules must be an object');
    }
  }

  private db(): FlagsPrisma {
    return this.prisma as unknown as FlagsPrisma;
  }
}
