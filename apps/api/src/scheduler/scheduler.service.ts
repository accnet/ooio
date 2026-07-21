import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseAllocationService } from '../das/das.service';
import { PrismaService } from '../prisma/prisma.service';
import { loadPlacementConfig, PlacementConfig } from './placement.config';

export interface Placement {
  clusterId: string;
  nodeId: string | null;
}

interface CapacitySnapshot {
  cpuPercent: number;
  memoryPercent: number;
  diskPercent: number;
  siteCount: number;
}

@Injectable()
export class SchedulerService {
  readonly placementConfig: PlacementConfig;

  constructor(
    private readonly prisma: PrismaService,
    private readonly das: DatabaseAllocationService,
    config: ConfigService,
  ) {
    this.placementConfig = loadPlacementConfig(config);
  }

  async placeStore(): Promise<Placement> {
    const clusters = await this.prisma.cluster.findMany({
      where: { status: 'active' },
      include: {
        nodes: {
          where: { status: { in: ['ready', 'active'] } },
          include: {
            stores: { where: { status: { not: 'deleted' } }, select: { id: true } },
          },
        },
      },
      orderBy: [{ weight: 'desc' }, { createdAt: 'asc' }],
    });

    if (!clusters.length) {
      const cluster = await this.prisma.cluster.upsert({
        where: { name: 'default' },
        create: { name: 'default', region: 'default' },
        update: {},
      });
      return { clusterId: cluster.id, nodeId: null };
    }
    const candidates = clusters.flatMap((cluster) => cluster.nodes.map((node) => ({
        cluster,
        node,
        capacity: this.capacity(node.capacity),
        storeCount: node.stores.length,
      })))
      .filter(({ capacity, storeCount }) =>
        storeCount < this.placementConfig.maxStoresPerNode &&
        capacity.cpuPercent <= this.placementConfig.maxCpuPercent &&
        capacity.memoryPercent <= this.placementConfig.maxMemoryPercent,
      )
      .sort((left, right) => {
        const scoreDifference = this.score(left.capacity, left.storeCount) - this.score(right.capacity, right.storeCount);
        return scoreDifference || right.cluster.weight - left.cluster.weight;
      });

    const selected = candidates[0];
    const cluster = selected?.cluster ?? clusters[0];
    return {
      clusterId: cluster.id,
      nodeId: selected?.node.id ?? null,
    };
  }

  allocateDatabase(storeId: string, clusterId: string) {
    return this.das.allocate({ storeId, clusterId });
  }

  async reconcilePending(): Promise<number> {
    const pending = await this.prisma.operation.findMany({
      where: {
        status: 'pending',
        store: { is: { nodeId: null } },
      },
      include: { store: true },
      orderBy: { createdAt: 'asc' },
    });
    let assigned = 0;
    for (const operation of pending) {
      if (!operation.store) {
        continue;
      }
      const placement = await this.placeStore();
      if (!placement.nodeId) {
        continue;
      }
      await this.prisma.store.update({
        where: { id: operation.store.id },
        data: {
          clusterId: placement.clusterId,
          nodeId: placement.nodeId,
        },
      });
      assigned += 1;
    }
    return assigned;
  }

  private capacity(value: unknown): CapacitySnapshot {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { cpuPercent: 0, memoryPercent: 0, diskPercent: 0, siteCount: 0 };
    }
    const source = value as Record<string, unknown>;
    return {
      cpuPercent: this.percent(source.cpuPercent),
      memoryPercent: this.percent(source.memoryPercent),
      diskPercent: this.percent(source.diskPercent),
      siteCount: this.nonNegative(source.siteCount),
    };
  }

  private score(capacity: CapacitySnapshot, storeCount: number): number {
    const weights = this.placementConfig.weights;
    return (
      weights.cpu * capacity.cpuPercent / 100 +
      weights.memory * capacity.memoryPercent / 100 +
      weights.disk * capacity.diskPercent / 100 +
      weights.stores * storeCount / this.placementConfig.maxStoresPerNode
    );
  }

  private percent(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : 0;
  }

  private nonNegative(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  }
}
