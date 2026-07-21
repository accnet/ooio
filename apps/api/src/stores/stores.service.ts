import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { WorkflowService } from '../workflow/workflow.service';
import { SchedulerService } from '../scheduler/scheduler.service';
import { QuotaService } from '../billing/quota.service';

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

@Injectable()
export class StoresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflow: WorkflowService,
    private readonly scheduler: SchedulerService,
    private readonly quota: QuotaService,
  ) {}

  async create(input: CreateStoreInput, organizationId: string): Promise<{ storeId: string; operationId: string; status: string }> {
    this.validate(input);
    const organization = await this.prisma.organization.findUnique({ where: { id: organizationId } });
    if (!organization) {
      throw new NotFoundException('organization not found');
    }
    await this.quota.assertStoreCreationAllowed(organizationId);
    const placement = await this.scheduler.placeStore();
    const store = await this.prisma.store.create({
      data: {
        organizationId: organization.id,
        clusterId: placement.clusterId,
        nodeId: placement.nodeId,
        externalId: randomUUID(),
        status: 'provisioning',
      },
    });
    try {
      await this.scheduler.allocateDatabase(store.id, placement.clusterId);
    } catch (error) {
      await this.prisma.store.delete({ where: { id: store.id } });
      throw error;
    }
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

  private validate(input: CreateStoreInput): void {
    if (!input || !input.domain?.trim() || !input.path?.trim() || !input.title?.trim() || !input.adminEmail?.trim()) {
      throw new Error('domain, path, title, and adminEmail are required');
    }
    if (!/^\S+@\S+\.\S+$/.test(input.adminEmail)) {
      throw new Error('adminEmail must be a valid email');
    }
  }
}
