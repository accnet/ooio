import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Plan } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface PlanDefinition {
  slug: string;
  name: string;
  priceCents: number;
  limits: { maxStores: number };
}

const SEED_PLANS: readonly PlanDefinition[] = [
  { slug: 'free', name: 'Free', priceCents: 0, limits: { maxStores: 1 } },
  { slug: 'pro', name: 'Pro', priceCents: 2900, limits: { maxStores: 10 } },
  { slug: 'enterprise', name: 'Enterprise', priceCents: 9900, limits: { maxStores: 100 } },
];

@Injectable()
export class PlansSeed {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  getDefaultPlanSlug(): string {
    const configured = this.config.get<string>('DEFAULT_PLAN', 'free')?.trim().toLowerCase();
    return configured && SEED_PLANS.some((plan) => plan.slug === configured) ? configured : 'free';
  }

  definitions(): PlanDefinition[] {
    return SEED_PLANS.map((plan) => ({
      ...plan,
      priceCents: this.numberConfig(`PLAN_${plan.slug.toUpperCase()}_PRICE_CENTS`, plan.priceCents),
      limits: {
        maxStores: this.numberConfig(`PLAN_${plan.slug.toUpperCase()}_MAX_STORES`, plan.limits.maxStores),
      },
    }));
  }

  async seed(): Promise<void> {
    for (const plan of this.definitions()) {
      await this.prisma.plan.upsert({
        where: { slug: plan.slug },
        create: {
          slug: plan.slug,
          name: plan.name,
          priceCents: plan.priceCents,
          limits: plan.limits as Prisma.InputJsonValue,
          active: true,
        },
        // Existing plan rows may have been customized by an operator. Seeding
        // is intentionally additive and does not overwrite those values.
        update: {},
      });
    }
  }

  async defaultPlan(): Promise<Plan> {
    const plan = await this.prisma.plan.findUnique({ where: { slug: this.getDefaultPlanSlug() } });
    if (!plan) {
      await this.seed();
      return this.prisma.plan.findUniqueOrThrow({ where: { slug: this.getDefaultPlanSlug() } });
    }
    return plan;
  }

  private numberConfig(key: string, fallback: number): number {
    const value = Number(this.config.get<string | number>(key, fallback));
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
  }
}
