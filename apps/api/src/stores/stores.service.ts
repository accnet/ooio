import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { WorkflowService } from '../workflow/workflow.service';
import { SchedulerService } from '../scheduler/scheduler.service';
import { QuotaService } from '../billing/quota.service';
import { EventService } from '../events/events.service';

export interface CreateStoreInput {
  domain: string;
  path: string;
  title: string;
  adminEmail: string;
}

export interface CreateStoreOperationInput {
  type: string;
  payload?: Record<string, unknown>;
}

const STORE_DETAIL_SELECT = {
  id: true,
  externalId: true,
  status: true,
  tier: true,
  title: true,
  path: true,
  distribution: true,
  runtimeVer: true,
  createdAt: true,
  updatedAt: true,
  domains: {
    select: {
      hostname: true,
      verified: true,
      tlsStatus: true,
    },
    orderBy: { hostname: 'asc' as const },
  },
} as const;

const STORE_OPERATION_SELECT = {
  id: true,
  type: true,
  status: true,
  progress: true,
  error: true,
  createdAt: true,
  updatedAt: true,
} as const;

const DEFAULT_OPERATION_PAGE_SIZE = 20;
const MAX_OPERATION_PAGE_SIZE = 100;

@Injectable()
export class StoresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflow: WorkflowService,
    private readonly scheduler: SchedulerService,
    private readonly quota: QuotaService,
    private readonly events: EventService,
  ) {}

  async create(input: CreateStoreInput, organizationId: string): Promise<{ storeId: string; operationId: string; status: string }> {
    this.validate(input);
    const organization = await this.prisma.organization.findUnique({ where: { id: organizationId } });
    if (!organization) {
      throw new NotFoundException('organization not found');
    }
    await this.quota.assertStoreCreationAllowed(organizationId);
    const placement = await this.scheduler.placeStore();
    const store = await this.prisma.$transaction(async (tx) => {
      const created = await tx.store.create({
        data: {
          organizationId: organization.id,
          clusterId: placement.clusterId,
          nodeId: placement.nodeId,
          externalId: randomUUID(),
          title: input.title.trim(),
          path: input.path.trim(),
          status: 'provisioning',
        } as Prisma.StoreUncheckedCreateInput,
      });
      await this.events.record(tx, {
        type: 'StoreCreated',
        aggregateType: 'store',
        aggregateId: created.id,
        payload: {
          storeId: created.id,
          organizationId: created.organizationId,
          clusterId: created.clusterId,
          nodeId: created.nodeId,
          status: created.status,
        },
      });
      // The database allocation joins THIS transaction on purpose. A store is not
      // created until it has a database, so the row, the allocation and the
      // StoreCreated event form one unit of work. Allocating afterwards and undoing
      // with a compensating delete would leave StoreCreated committed and already
      // published for a store that never existed — an event cannot be recalled.
      await this.scheduler.allocateDatabase(created.id, placement.clusterId, tx);
      return created;
    });
    // NOTE: no Domain row on create. In subdirectory multisite every store shares
    // the network domain, so a globally-unique hostname here would collide on the
    // second store. Domain records represent CUSTOM domains mapped to a store and
    // are created by the add-domain flow instead.
    const operation = await this.workflow.createOperation({
      organizationId: organization.id,
      storeId: store.id,
      type: 'create-store',
      payload: input as unknown as Prisma.InputJsonValue,
      actor: 'user',
    });
    return { storeId: store.id, operationId: operation.id, status: 'provisioning' };
  }

  async createOperation(
    storeId: string,
    input: CreateStoreOperationInput,
    organizationId: string,
    actor: string,
  ) {
    const store = await this.prisma.store.findFirst({ where: { id: storeId, organizationId } });
    if (!store) {
      throw new NotFoundException('store not found');
    }
    return this.workflow.createOperation({
      organizationId,
      storeId,
      type: input.type,
      payload: input.payload,
      actor,
    });
  }

  async list(organizationId: string) {
    return this.prisma.store.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      include: { domains: true },
    });
  }

  async get(storeId: string, organizationId: string) {
    const store = await this.prisma.store.findFirst({
      where: { id: storeId, organizationId },
      select: STORE_DETAIL_SELECT,
    });
    if (!store) {
      throw new NotFoundException('store not found');
    }
    return store;
  }

  async listOperations(
    storeId: string,
    organizationId: string,
    pageInput?: string,
    limitInput?: string,
  ) {
    const store = await this.prisma.store.findFirst({
      where: { id: storeId, organizationId },
      select: { id: true },
    });
    if (!store) {
      throw new NotFoundException('store not found');
    }

    const page = this.parsePositiveInteger(pageInput, 1, 'page');
    const limit = this.parsePositiveInteger(limitInput, DEFAULT_OPERATION_PAGE_SIZE, 'limit');
    if (limit > MAX_OPERATION_PAGE_SIZE) {
      throw new BadRequestException(`limit must be between 1 and ${MAX_OPERATION_PAGE_SIZE}`);
    }

    const where = { storeId: store.id, organizationId };
    const [total, operations] = await Promise.all([
      this.prisma.operation.count({ where }),
      this.prisma.operation.findMany({
        where,
        select: STORE_OPERATION_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

    return {
      operations,
      page,
      limit,
      total,
      totalPages,
    };
  }

  private parsePositiveInteger(value: string | undefined, fallback: number, field: string): number {
    if (value === undefined) {
      return fallback;
    }
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new BadRequestException(`${field} must be a positive integer`);
    }
    return parsed;
  }

  private validate(input: CreateStoreInput): void {
    if (!input || !input.domain?.trim() || !input.path?.trim() || !input.title?.trim() || !input.adminEmail?.trim()) {
      throw new Error('domain, path, title, and adminEmail are required');
    }
    if (!/^\S+@\S+\.\S+$/.test(input.adminEmail)) {
      throw new Error('adminEmail must be a valid email');
    }
  }
}
