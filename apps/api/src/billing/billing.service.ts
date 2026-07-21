import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Subscription } from '@prisma/client';
import { PlansSeed } from './plans.seed';
import { PrismaService } from '../prisma/prisma.service';

type InvoiceDelegate = {
  create(args: { data: Record<string, unknown> }): Promise<unknown>;
};

type PrismaWithInvoice = { invoice: InvoiceDelegate };

@Injectable()
export class BillingService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: PlansSeed,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.plans.seed();
  }

  async listPlans() {
    await this.plans.seed();
    return this.prisma.plan.findMany({ where: { active: true }, orderBy: { priceCents: 'asc' } });
  }

  async getSubscription(organizationId: string) {
    await this.requireOrganization(organizationId);
    const subscription = await this.prisma.subscription.findFirst({
      where: { organizationId, status: 'active' },
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!subscription) {
      return null;
    }
    return this.subscriptionResponse(subscription);
  }

  async changeSubscription(organizationId: string, planId: string) {
    await this.requireOrganization(organizationId);
    const plan = await this.prisma.plan.findFirst({ where: { id: planId, active: true } });
    if (!plan) {
      throw new NotFoundException('active plan not found');
    }

    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setUTCDate(periodEnd.getUTCDate() + this.periodDays());
    const current = await this.prisma.subscription.findFirst({
      where: { organizationId, status: 'active' },
      orderBy: { createdAt: 'desc' },
    });
    const changed = !current || current.planId !== plan.id;

    const result = await this.prisma.$transaction(async (tx) => {
      if (current && changed) {
        await tx.subscription.update({ where: { id: current.id }, data: { status: 'cancelled' } });
      }

      const subscription = current && !changed
        ? await tx.subscription.update({
          where: { id: current.id },
          data: { status: 'active', currentPeriodEnd: periodEnd },
          include: { plan: true },
        })
        : await tx.subscription.create({
          data: {
            organizationId,
            planId: plan.id,
            status: 'active',
            currentPeriodEnd: periodEnd,
          },
          include: { plan: true },
        });

      await tx.organization.update({ where: { id: organizationId }, data: { planId: plan.id } });
      if (changed) {
        await this.createInvoice(tx, {
          organizationId,
          amount: plan.priceCents,
          currency: this.config.get<string>('BILLING_CURRENCY', 'USD'),
          status: 'draft',
          periodStart: now,
          periodEnd,
        });
      }
      return subscription;
    });

    return this.subscriptionResponse(result);
  }

  private async requireOrganization(organizationId: string) {
    const organization = await this.prisma.organization.findUnique({ where: { id: organizationId } });
    if (!organization) {
      throw new NotFoundException('organization not found');
    }
    return organization;
  }

  private subscriptionResponse(subscription: Subscription & { plan: { slug: string; name: string; limits: Prisma.JsonValue | null; priceCents: number } }) {
    return {
      id: subscription.id,
      organizationId: subscription.organizationId,
      status: subscription.status,
      plan: subscription.plan,
      periodStart: subscription.createdAt,
      periodEnd: subscription.currentPeriodEnd,
    };
  }

  private periodDays(): number {
    const configured = Number(this.config.get<string | number>('BILLING_PERIOD_DAYS', 30));
    return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 30;
  }

  private async createInvoice(client: unknown, data: Record<string, unknown>): Promise<void> {
    // Invoice is part of the pending Prisma schema migration. Keeping this
    // delegate narrow lets the API compile before the operator runs generate.
    const invoice = (client as PrismaWithInvoice).invoice;
    await invoice.create({ data });
  }
}
