import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdminActor, AdminListQuery } from './admin.types';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

const ORGANIZATION_LIST_SELECT = {
  id: true,
  name: true,
  slug: true,
  status: true,
  createdAt: true,
  plan: { select: { id: true, name: true, slug: true } },
  _count: { select: { stores: true, memberships: true } },
  memberships: {
    where: { role: 'owner' },
    orderBy: { createdAt: 'asc' },
    take: 1,
    select: { user: { select: { email: true } } },
  },
} as const;

const ORGANIZATION_DETAIL_SELECT = {
  ...ORGANIZATION_LIST_SELECT,
  subscriptions: {
    where: { status: 'active' },
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: {
      id: true,
      status: true,
      currentPeriodEnd: true,
      createdAt: true,
      plan: { select: { id: true, name: true, slug: true, priceCents: true, limits: true } },
    },
  },
} as const;

// This is deliberately an explicit allowlist. Support can inspect business
// records, but infrastructure placement and database credentials belong to ops.
const STORE_LIST_SELECT = {
  id: true,
  organizationId: true,
  externalId: true,
  status: true,
  tier: true,
  distribution: true,
  runtimeVer: true,
  blogId: true,
  createdAt: true,
  updatedAt: true,
  organization: { select: { id: true, name: true, slug: true } },
  domains: {
    select: { hostname: true, verified: true, tlsStatus: true },
    orderBy: { hostname: 'asc' as const },
  },
} as const;

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listOrganizations(query: AdminListQuery, actor: AdminActor) {
    const page = this.page(query.page);
    const limit = this.limit(query.limit);
    const search = this.normalized(query.search);
    const where: Prisma.OrganizationWhereInput = search
      ? {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { slug: { contains: search, mode: 'insensitive' } },
          {
            memberships: {
              some: {
                role: 'owner',
                user: { email: { contains: search, mode: 'insensitive' } },
              },
            },
          },
        ],
      }
      : {};

    await this.audit.recordAdminAccess({
      organizationId: actor.organizationId,
      userId: actor.userId,
      action: 'admin.organizations.list',
      resourceType: 'organization',
      metadata: { search: search || null, page, limit },
    });

    const [total, organizations] = await Promise.all([
      this.prisma.organization.count({ where }),
      this.prisma.organization.findMany({
        where,
        select: ORGANIZATION_LIST_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      organizations: organizations.map((organization) => this.organizationSummary(organization)),
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    };
  }

  async getOrganization(id: string, actor: AdminActor) {
    await this.audit.recordAdminAccess({
      organizationId: actor.organizationId,
      userId: actor.userId,
      action: 'admin.organization.view',
      resourceType: 'organization',
      resourceId: id,
      metadata: { targetOrganizationId: id },
    });

    const organization = await this.prisma.organization.findUnique({
      where: { id },
      select: ORGANIZATION_DETAIL_SELECT,
    });
    if (!organization) {
      throw new NotFoundException('organization not found');
    }

    return {
      ...this.organizationSummary(organization),
      subscription: organization.subscriptions[0] || null,
    };
  }

  async listStores(query: AdminListQuery, actor: AdminActor, missingBlogId?: string) {
    const page = this.page(query.page);
    const limit = this.limit(query.limit);
    const organizationId = this.normalized(query.organizationId);
    const status = this.normalized(query.status);
    const reconciliationFilter = this.blogIdFilter(missingBlogId);
    const where: Prisma.StoreWhereInput = {
      ...(organizationId ? { organizationId } : {}),
      ...(reconciliationFilter ? { status: 'active', blogId: null } : status ? { status } : {}),
    };

    await this.audit.recordAdminAccess({
      organizationId: actor.organizationId,
      userId: actor.userId,
      action: 'admin.stores.list',
      resourceType: 'store',
      metadata: {
        organizationId: organizationId || null,
        status: reconciliationFilter ? 'active' : status || null,
        missingBlogId: reconciliationFilter,
        page,
        limit,
      },
    });

    const [total, stores] = await Promise.all([
      this.prisma.store.count({ where }),
      this.prisma.store.findMany({
        where,
        select: STORE_LIST_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      stores,
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    };
  }

  private organizationSummary(organization: {
    id: string;
    name: string;
    slug: string;
    status: string;
    createdAt: Date;
    plan: { id: string; name: string; slug: string } | null;
    _count: { stores: number; memberships: number };
    memberships: Array<{ user: { email: string } }>;
  }) {
    return {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      status: organization.status,
      plan: organization.plan,
      storeCount: organization._count.stores,
      memberCount: organization._count.memberships,
      ownerEmail: organization.memberships[0]?.user.email || null,
      createdAt: organization.createdAt,
    };
  }

  private page(value: number | undefined): number {
    return value === undefined ? 1 : value;
  }

  private limit(value: number | undefined): number {
    const limit = value === undefined ? DEFAULT_PAGE_SIZE : value;
    if (limit > MAX_PAGE_SIZE) {
      throw new BadRequestException(`limit must be between 1 and ${MAX_PAGE_SIZE}`);
    }
    return limit;
  }

  private normalized(value: string | undefined): string | undefined {
    const normalized = value?.trim();
    return normalized || undefined;
  }

  private blogIdFilter(value: string | undefined): boolean {
    if (value === undefined || value === 'false') {
      return false;
    }
    if (value === 'true') {
      return true;
    }
    throw new BadRequestException('missingBlogId must be true or false');
  }
}
