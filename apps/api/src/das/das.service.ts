import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
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

  /**
   * When `tx` is supplied the allocation joins the caller's transaction instead of
   * opening its own. Store creation needs this: a store is not created until it has
   * a database, so the row, the allocation and the StoreCreated event must commit or
   * roll back together. Compensating with a delete after the fact leaves a published
   * event pointing at a store that never existed.
   */
  async allocate(
    input: AllocateDatabaseInput,
    tx?: Prisma.TransactionClient,
  ): Promise<DatabaseAllocation> {
    if (!input.storeId?.trim() || !input.clusterId?.trim()) {
      throw new ConflictException('storeId and clusterId are required for database allocation');
    }

    const run = async (transaction: Prisma.TransactionClient) => {
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
    };

    const result = tx ? await run(tx) : await this.prisma.$transaction(run);

    this.logger.log(`database allocation completed pool=${result.poolId} epoch=${result.epoch}`);
    return result;
  }

  /**
   * Validate a migration destination in the DAS. Migration code must not copy
   * pool placement rules because this is the single owner of that invariant.
   */
  async validateMigrationTarget(input: {
    storeId: string;
    toPoolId: string;
  }): Promise<{ clusterId: string; fromPoolId: string; toPoolId: string }> {
    const db = this.prisma as any;
    const store = await db.store.findUnique({
      where: { id: input.storeId },
      select: { id: true, clusterId: true, dbPoolId: true },
    });
    if (!store) {
      throw new NotFoundException('store not found');
    }
    if (!store.dbPoolId) {
      throw new ConflictException('store has no source database pool');
    }
    if (!input.toPoolId?.trim() || input.toPoolId === store.dbPoolId) {
      throw new ConflictException('migration destination must differ from the source pool');
    }

    const destination = await db.dbPool.findUnique({ where: { id: input.toPoolId } });
    if (!destination || destination.clusterId !== store.clusterId) {
      throw new ConflictException('migration destination pool is not in the store cluster');
    }
    this.assertHealthyWithCapacity(destination);
    return { clusterId: store.clusterId, fromPoolId: store.dbPoolId, toPoolId: destination.id };
  }

  /**
   * Publish the new mapping epoch and placement history atomically. This only
   * changes control-plane routing metadata; H2 data movement remains a separate
   * seam in MigrationsService.
   */
  async switchStorePool(input: {
    storeId: string;
    fromPoolId: string;
    toPoolId: string;
    reason: string;
    operationId?: string;
  }, tx?: Prisma.TransactionClient): Promise<{ poolId: string; dataset: string; epoch: number }> {
    const run = async (transaction: Prisma.TransactionClient) => {
      const db = transaction as any;
      const store = await db.store.findUnique({
        where: { id: input.storeId },
        select: { id: true, clusterId: true, dbPoolId: true },
      });
      if (!store) {
        throw new NotFoundException('store not found');
      }
      if (store.dbPoolId !== input.fromPoolId) {
        throw new ConflictException('store source pool changed before switching');
      }
      if (input.fromPoolId === input.toPoolId) {
        throw new ConflictException('migration destination must differ from the source pool');
      }

      const [source, destination] = await Promise.all([
        db.dbPool.findUnique({ where: { id: input.fromPoolId } }),
        db.dbPool.findUnique({ where: { id: input.toPoolId } }),
      ]);
      if (!source || source.clusterId !== store.clusterId) {
        throw new ConflictException('migration source pool is not in the store cluster');
      }
      if (!destination || destination.clusterId !== store.clusterId) {
        throw new ConflictException('migration destination pool is not in the store cluster');
      }
      this.assertHealthyWithCapacity(destination);

      const released = await db.dbPool.updateMany({
        where: { id: source.id, used: { gt: 0 } },
        data: { used: { decrement: 1 } },
      });
      if (released.count !== 1) {
        throw new ConflictException('source database pool has no allocated capacity to release');
      }
      const claimedWhere: Record<string, unknown> = { id: destination.id, status: 'healthy' };
      if (destination.capacity > 0) {
        claimedWhere.used = { lt: destination.capacity };
      }
      const claimed = await db.dbPool.updateMany({
        where: claimedWhere,
        data: { used: { increment: 1 } },
      });
      if (claimed.count !== 1) {
        throw new ConflictException('migration destination pool became unavailable during switching');
      }

      const mappingEpoch = await db.mappingEpoch.upsert({
        where: { clusterId: store.clusterId },
        create: { clusterId: store.clusterId, epoch: 1 },
        update: { epoch: { increment: 1 } },
      });
      const dataset = `store_${input.storeId}`;
      await db.store.update({
        where: { id: input.storeId },
        data: { dbPoolId: destination.id, dataset },
      });
      await db.storePlacementHistory.create({
        data: {
          storeId: input.storeId,
          fromPoolId: source.id,
          toPoolId: destination.id,
          reason: input.reason,
          operationId: input.operationId,
        },
      });
      return { poolId: destination.id, dataset, epoch: mappingEpoch.epoch };
    };

    return tx ? run(tx) : this.prisma.$transaction(run);
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

  private assertHealthyWithCapacity(pool: { status: string; capacity: number; used: number }): void {
    if (pool.status !== 'healthy') {
      throw new ConflictException('migration destination pool must be healthy');
    }
    if (pool.capacity > 0 && pool.used >= pool.capacity) {
      throw new ConflictException('migration destination pool has no capacity');
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
