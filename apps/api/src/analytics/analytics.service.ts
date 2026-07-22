import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

interface StoreMetric {
  id: string;
  status: string;
  createdAt: Date;
}

interface OperationMetric {
  status: string;
}

interface NodeMetric {
  id: string;
  clusterId: string;
  hostname: string;
  status: string;
  health: string | null;
  capacity: Prisma.JsonValue | null;
  lastHeartbeatAt: Date | null;
}

interface ClusterMetric {
  id: string;
  name: string;
  region: string;
  status: string;
}

interface AnalyticsPrisma {
  store: {
    findMany(args: { where: Record<string, unknown>; select: Record<string, boolean> }): Promise<StoreMetric[]>;
  };
  operation: {
    findMany(args: { where: Record<string, unknown>; select: Record<string, boolean> }): Promise<OperationMetric[]>;
  };
  node: {
    findMany(args: { select: Record<string, boolean> }): Promise<NodeMetric[]>;
  };
  cluster: {
    findMany(args: { select: Record<string, boolean>; orderBy: Record<string, string> }): Promise<ClusterMetric[]>;
  };
}

interface DateRange {
  from: Date;
  to: Date;
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `capacity` describes clusters and nodes — hostnames, health and resource
   * percentages. That is operator information: a customer has no use for it, and
   * exposing it makes placement (and therefore store migration between pools)
   * observable from outside the platform.
   *
   * The decision is made HERE rather than by stripping fields in the controller,
   * because stripping after the fact still means the rows were read for a caller
   * who was never entitled to them.
   */
  async overview(organizationId: string, platformRole?: string | null) {
    const isOperator = platformRole === 'operator';
    const stores = await this.db().store.findMany({
      where: { organizationId },
      select: { id: true, status: true, createdAt: true },
    });
    const operations = await this.db().operation.findMany({
      where: { organizationId },
      select: { status: true },
    });

    const now = new Date();
    const range = { from: this.startOfDay(new Date(now.getTime() - 29 * 86400000)), to: now };
    const summary = {
      stores: this.countByStatus(stores),
      growth: this.growth(stores, range),
      operations: this.operationSummary(operations),
    };
    if (!isOperator) {
      return summary;
    }

    const [nodes, clusters] = await Promise.all([
      this.db().node.findMany({
        select: { id: true, clusterId: true, hostname: true, status: true, health: true, capacity: true, lastHeartbeatAt: true },
      }),
      this.db().cluster.findMany({
        select: { id: true, name: true, region: true, status: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    return {
      ...summary,
      capacity: clusters.map((cluster) => ({
        ...cluster,
        nodes: nodes.filter((node) => node.clusterId === cluster.id).map((node) => ({
          id: node.id,
          hostname: node.hostname,
          status: node.status,
          health: node.health,
          capacity: this.objectValue(node.capacity),
          lastHeartbeatAt: node.lastHeartbeatAt,
        })),
      })),
    };
  }

  async stores(organizationId: string, fromInput?: string, toInput?: string) {
    const range = this.parseRange(fromInput, toInput);
    const stores = await this.db().store.findMany({
      where: {
        organizationId,
        createdAt: { gte: range.from, lte: range.to },
      },
      select: { id: true, status: true, createdAt: true },
    });
    return {
      from: range.from,
      to: range.to,
      totals: this.countByStatus(stores),
      growth: this.growth(stores, range),
    };
  }

  private countByStatus(stores: StoreMetric[]): Record<string, number> {
    return stores.reduce<Record<string, number>>((counts, store) => {
      counts[store.status] = (counts[store.status] || 0) + 1;
      return counts;
    }, {});
  }

  private operationSummary(operations: OperationMetric[]) {
    const succeeded = operations.filter((operation) => operation.status === 'succeeded').length;
    const failed = operations.filter((operation) => operation.status === 'failed').length;
    const completed = succeeded + failed;
    return {
      total: operations.length,
      succeeded,
      failed,
      successRate: completed === 0 ? 0 : succeeded / completed,
      failureRate: completed === 0 ? 0 : failed / completed,
    };
  }

  private growth(stores: StoreMetric[], range: DateRange) {
    const byDay = new Map<string, number>();
    for (const store of stores) {
      const day = this.startOfDay(store.createdAt).toISOString().slice(0, 10);
      byDay.set(day, (byDay.get(day) || 0) + 1);
    }
    const rows: Array<{ date: string; created: number }> = [];
    for (let cursor = this.startOfDay(range.from); cursor <= range.to; cursor = new Date(cursor.getTime() + 86400000)) {
      const date = cursor.toISOString().slice(0, 10);
      rows.push({ date, created: byDay.get(date) || 0 });
    }
    return rows;
  }

  private parseRange(fromInput?: string, toInput?: string): DateRange {
    const now = new Date();
    const from = fromInput ? this.parseDate(fromInput, 'from') : this.startOfDay(new Date(now.getTime() - 29 * 86400000));
    const to = toInput ? this.parseDate(toInput, 'to') : now;
    if (from > to) {
      throw new BadRequestException('from must be before or equal to to');
    }
    return { from, to };
  }

  private parseDate(value: string, field: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`${field} must be a valid ISO date`);
    }
    return date;
  }

  private startOfDay(date: Date): Date {
    const result = new Date(date);
    result.setUTCHours(0, 0, 0, 0);
    return result;
  }

  private objectValue(value: Prisma.JsonValue | null): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  }

  private db(): AnalyticsPrisma {
    return this.prisma as unknown as AnalyticsPrisma;
  }
}
