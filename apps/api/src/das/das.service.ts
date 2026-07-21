import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  AllocateDatabaseInput,
  DatabaseAllocation,
  DB_POOL_STATUSES,
  DbPoolStatus,
  RegisterPoolInput,
} from './allocation.types';

const ALLOCATION_BLOCKING_STATUSES = new Set<DbPoolStatus>([
  'draining',
  'maintenance',
  'retiring',
  'deleted',
]);

@Injectable()
export class DatabaseAllocationService {
  private readonly logger = new Logger(DatabaseAllocationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async allocate(input: AllocateDatabaseInput): Promise<DatabaseAllocation> {
    if (!input.storeId?.trim() || !input.clusterId?.trim()) {
      throw new ConflictException('storeId and clusterId are required for database allocation');
    }

    const result = await this.prisma.$transaction(async (transaction) => {
      // H0 intentionally keeps credentials behind a reference. The generated
      // Prisma client is refreshed by the deployment/migration step after the
      // schema change, so this local alias keeps the source buildable meanwhile.
      const db = transaction as any;
      const store = await db.store.findUnique({
        where: { id: input.storeId },
        select: { id: true, clusterId: true, dbPoolId: true },
      });
      if (!store) {
        throw new NotFoundException('store not found');
      }
      if (store.clusterId !== input.clusterId) {
        throw new ConflictException('store does not belong to the requested cluster');
      }
      if (store.dbPoolId) {
        throw new ConflictException('store already has a database allocation');
      }

      const pools = await db.dbPool.findMany({
        where: { clusterId: input.clusterId, status: 'healthy' },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      const pool = pools.find((candidate: { capacity: number; used: number }) =>
        candidate.capacity <= 0 || candidate.used < candidate.capacity,
      );
      if (!pool) {
        throw new ConflictException('no healthy database pool with capacity is available');
      }

      const updateWhere: Record<string, unknown> = {
        id: pool.id,
        status: 'healthy',
      };
      if (pool.capacity > 0) {
        updateWhere.used = { lt: pool.capacity };
      }
      const claimed = await db.dbPool.updateMany({
        where: updateWhere,
        data: { used: { increment: 1 } },
      });
      if (claimed.count !== 1) {
        throw new ConflictException('database pool became unavailable during allocation');
      }

      const mappingEpoch = await db.mappingEpoch.upsert({
        where: { clusterId: input.clusterId },
        create: { clusterId: input.clusterId, epoch: 1 },
        update: { epoch: { increment: 1 } },
      });
      const dataset = `store_${input.storeId}`;
      await db.store.update({
        where: { id: input.storeId },
        data: { dbPoolId: pool.id, dataset },
      });
      await db.storePlacementHistory.create({
        data: {
          storeId: input.storeId,
          toPoolId: pool.id,
          reason: 'initial-allocation',
        },
      });

      return {
        poolId: pool.id,
        dataset,
        connectionRef: `secret://${pool.name}`,
        epoch: mappingEpoch.epoch,
      } satisfies DatabaseAllocation;
    });

    this.logger.log(`database allocation completed pool=${result.poolId} epoch=${result.epoch}`);
    return result;
  }

  async listPools(clusterId?: string) {
    const db = this.prisma as any;
    const pools = await db.dbPool.findMany({
      where: clusterId ? { clusterId } : undefined,
      orderBy: [{ clusterId: 'asc' }, { createdAt: 'asc' }],
    });
    return pools.map((pool: Record<string, unknown>) => this.poolView(pool));
  }

  async getPool(id: string) {
    const db = this.prisma as any;
    const pool = await db.dbPool.findUnique({ where: { id } });
    if (!pool) {
      throw new NotFoundException('database pool not found');
    }
    return this.poolView(pool);
  }

  async registerPool(input: RegisterPoolInput) {
    this.validatePoolInput(input);
    const db = this.prisma as any;
    const pool = await db.dbPool.create({
      data: {
        clusterId: input.clusterId,
        name: input.name.trim(),
        host: input.host.trim(),
        port: input.port ?? 3306,
        databaseName: input.databaseName.trim(),
        username: input.username.trim(),
        secretRef: input.secretRef?.trim() || null,
        capacity: input.capacity ?? 0,
        status: input.status ?? 'healthy',
      },
    });
    return this.poolView(pool);
  }

  async updatePoolStatus(id: string, status: DbPoolStatus) {
    if (!DB_POOL_STATUSES.includes(status)) {
      throw new ConflictException(`invalid database pool status: ${status}`);
    }
    const db = this.prisma as any;
    const pool = await db.dbPool.findUnique({ where: { id } });
    if (!pool) {
      throw new NotFoundException('database pool not found');
    }
    if (status === 'retiring' && pool.used > 0) {
      throw new ConflictException('database pool cannot retire while used > 0');
    }
    if (ALLOCATION_BLOCKING_STATUSES.has(status)) {
      this.logger.warn(`database pool ${id} status changed to ${status}`);
    }
    const updated = await db.dbPool.update({ where: { id }, data: { status } });
    return this.poolView(updated);
  }

  async getMappingEpoch(clusterId: string): Promise<{ clusterId: string; epoch: number }> {
    const db = this.prisma as any;
    const cluster = await db.cluster.findUnique({ where: { id: clusterId }, select: { id: true } });
    if (!cluster) {
      throw new NotFoundException('cluster not found');
    }
    const mappingEpoch = await db.mappingEpoch.findUnique({ where: { clusterId } });
    // Epoch 0 means "no mapping published yet". The first allocation upserts to 1,
    // so every mapping change is strictly greater than what a node last ACKed
    // (ADR-006 §4). Defaulting to 1 here would make the first change invisible.
    return { clusterId, epoch: mappingEpoch?.epoch ?? 0 };
  }

  private validatePoolInput(input: RegisterPoolInput): void {
    if (!input.clusterId?.trim() || !input.name?.trim() || !input.host?.trim() ||
      !input.databaseName?.trim() || !input.username?.trim()) {
      throw new ConflictException('clusterId, name, host, databaseName, and username are required');
    }
    if (input.port !== undefined && (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535)) {
      throw new ConflictException('port must be an integer between 1 and 65535');
    }
    if (input.capacity !== undefined && (!Number.isInteger(input.capacity) || input.capacity < 0)) {
      throw new ConflictException('capacity must be a non-negative integer');
    }
    if (input.status !== undefined && !DB_POOL_STATUSES.includes(input.status)) {
      throw new ConflictException(`invalid database pool status: ${input.status}`);
    }
  }

  private poolView(pool: Record<string, unknown>) {
    return {
      id: pool.id,
      clusterId: pool.clusterId,
      name: pool.name,
      status: pool.status,
      capacity: pool.capacity,
      used: pool.used,
      createdAt: pool.createdAt,
      updatedAt: pool.updatedAt,
    };
  }
}
