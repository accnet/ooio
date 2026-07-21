import { HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PlansSeed } from './plans.seed';
import { PrismaService } from '../prisma/prisma.service';

export interface StoreUsage {
  stores: { used: number; limit: number };
  plan: string;
}

@Injectable()
export class QuotaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: PlansSeed,
    private readonly config: ConfigService,
  ) {}

  async getUsage(organizationId: string): Promise<StoreUsage> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      include: { plan: true, subscriptions: { where: { status: 'active' }, orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!organization) {
      throw new NotFoundException('organization not found');
    }

    const plan = organization.subscriptions[0]?.planId
      ? await this.prisma.plan.findUnique({ where: { id: organization.subscriptions[0].planId } })
      : organization.plan || await this.plans.defaultPlan();
    if (!plan) {
      throw new NotFoundException('organization plan not found');
    }

    const used = await this.prisma.store.count({ where: { organizationId } });
    return {
      stores: { used, limit: this.maxStores(plan.limits) },
      plan: plan.slug,
    };
  }

  async assertStoreCreationAllowed(organizationId: string): Promise<void> {
    const usage = await this.getUsage(organizationId);
    if (usage.stores.used >= usage.stores.limit) {
      throw new HttpException(
        `store quota exceeded: ${usage.stores.used}/${usage.stores.limit} on plan ${usage.plan}`,
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
  }

  private maxStores(limits: Prisma.JsonValue | null): number {
    if (limits && typeof limits === 'object' && !Array.isArray(limits)) {
      const value = Number((limits as Record<string, unknown>).maxStores);
      if (Number.isFinite(value) && value >= 0) {
        return Math.floor(value);
      }
    }
    const fallback = Number(this.config.get<string | number>('PLAN_FREE_MAX_STORES', 1));
    return Number.isFinite(fallback) && fallback >= 0 ? Math.floor(fallback) : 1;
  }
}
