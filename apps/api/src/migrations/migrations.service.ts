import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseAllocationService } from '../das/das.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  AcknowledgeMigrationInput,
  CreateMigrationInput,
  MigrationRecord,
  MigrationState,
} from './migration.types';
import {
  assertMigrationTransition,
  isMigrationTerminal,
  migrationState,
} from './migration.state-machine';

const ACTIVE_NODE_STATUSES = ['ready', 'busy', 'active'];

@Injectable()
export class MigrationsService {
  private readonly logger = new Logger(MigrationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly das: DatabaseAllocationService,
  ) {}

  async plan(storeId: string, input: CreateMigrationInput, organizationId: string): Promise<MigrationRecord> {
    if (!input?.toPoolId?.trim() || !input.reason?.trim()) {
      throw new ConflictException('toPoolId and reason are required');
    }
    const store = await this.prisma.store.findFirst({
      where: { id: storeId, organizationId },
      select: { id: true },
    });
    if (!store) {
      throw new NotFoundException('store not found');
    }

    const placement = await this.das.validateMigrationTarget({
      storeId,
      toPoolId: input.toPoolId.trim(),
    });
    const db = this.prisma as any;
    const migration = await db.storeMigration.create({
      data: {
        storeId,
        fromPoolId: placement.fromPoolId,
        toPoolId: placement.toPoolId,
        state: 'planned',
        ackedNodes: [],
        reason: input.reason.trim(),
      },
    });
    this.logger.log(`store migration planned id=${migration.id} store=${storeId}`);
    return migration as MigrationRecord;
  }

  async list(storeId: string, organizationId: string): Promise<MigrationRecord[]> {
    await this.requireStore(storeId, organizationId);
    const db = this.prisma as any;
    return db.storeMigration.findMany({
      where: { storeId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  async get(id: string, organizationId?: string): Promise<MigrationRecord> {
    const db = this.prisma as any;
    const migration = await db.storeMigration.findFirst({
      where: organizationId ? { id, store: { organizationId } } : { id },
    });
    if (!migration) {
      throw new NotFoundException('migration not found');
    }
    return migration as MigrationRecord;
  }

  async abort(id: string, organizationId: string): Promise<MigrationRecord> {
    const migration = await this.get(id, organizationId);
    const state = migrationState(migration.state);
    if (isMigrationTerminal(state)) {
      throw new ConflictException(`migration cannot be aborted from ${state}`);
    }
    assertMigrationTransition(state, 'aborted');
    return this.updateState(migration, 'aborted', { lastError: 'aborted by request' });
  }

  /**
   * This method is intentionally internal-facing: no endpoint can advance a
   * migration past a data-moving seam until H2 supplies the implementation.
   */
  async advance(id: string, target: MigrationState, organizationId?: string): Promise<MigrationRecord> {
    const migration = await this.get(id, organizationId || undefined);
    const current = migrationState(migration.state);
    assertMigrationTransition(current, target);

    try {
      if (target === 'restoring') {
        await this.restore(migration);
      } else if (target === 'freezing') {
        await this.freezeReads(migration);
      } else if (target === 'catching-up') {
        await this.catchUpBinlog(migration);
      } else if (target === 'verifying') {
        await this.verifyChecksum(migration);
      } else if (target === 'switching') {
        return await this.switchMapping(migration);
      }
    } catch (error) {
      const db = this.prisma as any;
      await db.storeMigration.update({
        where: { id: migration.id },
        data: {
          state: 'aborted',
          lastError: error instanceof Error ? error.message : 'migration step failed',
        },
      });
      throw error;
    }
    return this.updateState(migration, target);
  }

  async acknowledge(
    id: string,
    input: AcknowledgeMigrationInput,
    organizationId: string,
  ): Promise<MigrationRecord> {
    if (!input?.nodeId?.trim() || !Number.isInteger(input.epoch) || input.epoch < 1) {
      throw new ConflictException('nodeId and a positive integer epoch are required');
    }
    const migration = await this.get(id, organizationId);
    const state = migrationState(migration.state);
    if (state !== 'switching' && state !== 'acked') {
      throw new ConflictException(`migration cannot receive ACK from ${state}`);
    }
    if (migration.epoch === null || input.epoch !== migration.epoch) {
      throw new ConflictException(`ACK epoch ${input.epoch} does not match migration epoch ${migration.epoch}`);
    }

    const store = await this.prisma.store.findUnique({
      where: { id: migration.storeId },
      select: { clusterId: true },
    });
    if (!store) {
      throw new NotFoundException('store not found');
    }
    const activeNodeIds = await this.activeNodeIds(store.clusterId);
    if (!activeNodeIds.includes(input.nodeId)) {
      throw new ConflictException('node is not an active node in the store cluster');
    }
    const ackedNodes = this.ackedNodeIds(migration.ackedNodes);
    if (!ackedNodes.includes(input.nodeId)) {
      ackedNodes.push(input.nodeId);
    }

    const data: Record<string, unknown> = {
      ackedNodes: ackedNodes as unknown as Prisma.InputJsonValue,
    };
    if (state === 'switching' && activeNodeIds.every((nodeId) => ackedNodes.includes(nodeId))) {
      data.state = 'acked';
    }
    const db = this.prisma as any;
    const updated = await db.storeMigration.update({ where: { id: migration.id }, data });
    this.logger.log(`store migration ACK id=${migration.id} node=${input.nodeId} epoch=${input.epoch}`);
    return updated as MigrationRecord;
  }

  /**
   * Delete-old is guarded by the exact epoch ACK set. It is deliberately not
   * exposed as an HTTP route; the H2 data plane must call this after all nodes
   * have acknowledged the mapping published by DAS.
   */
  async complete(id: string, organizationId?: string): Promise<MigrationRecord> {
    const migration = await this.get(id, organizationId || undefined);
    const state = migrationState(migration.state);
    assertMigrationTransition(state, 'completed');
    if (migration.epoch === null) {
      throw new ConflictException('migration cannot complete without a mapping epoch');
    }
    const store = await this.prisma.store.findUnique({
      where: { id: migration.storeId },
      select: { clusterId: true },
    });
    if (!store) {
      throw new NotFoundException('store not found');
    }
    const activeNodeIds = await this.activeNodeIds(store.clusterId);
    const ackedNodes = this.ackedNodeIds(migration.ackedNodes);
    if (!activeNodeIds.every((nodeId) => ackedNodes.includes(nodeId))) {
      throw new ConflictException('migration cannot complete until every active node ACKs the exact epoch');
    }
    return this.updateState(migration, 'completed', { completedAt: new Date() });
  }

  // H2 seams: refusing here prevents a false migration success and silent data loss.
  async restore(_migration: MigrationRecord): Promise<never> {
    throw new NotImplementedException('restore belongs to H2 (ADR-006 section 5)');
  }

  async freezeReads(_migration: MigrationRecord): Promise<never> {
    throw new NotImplementedException('read-only freeze belongs to H2 (ADR-006 section 5)');
  }

  async catchUpBinlog(_migration: MigrationRecord): Promise<never> {
    throw new NotImplementedException('binlog catch-up belongs to H2 (ADR-006 section 5)');
  }

  async verifyChecksum(_migration: MigrationRecord): Promise<never> {
    throw new NotImplementedException('checksum verification belongs to H2 (ADR-006 section 5)');
  }

  private async switchMapping(migration: MigrationRecord): Promise<MigrationRecord> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const switched = await this.das.switchStorePool({
        storeId: migration.storeId,
        fromPoolId: migration.fromPoolId,
        toPoolId: migration.toPoolId,
        reason: migration.reason,
      }, tx);
      const db = tx as any;
      return db.storeMigration.update({
        where: { id: migration.id },
        data: {
          state: 'switching',
          epoch: switched.epoch,
          ackedNodes: [],
          lastError: null,
        },
      });
    });
    this.logger.log(`store migration mapping switched id=${migration.id} epoch=${updated.epoch}`);
    return updated as MigrationRecord;
  }

  private async updateState(
    migration: MigrationRecord,
    state: MigrationState,
    extra: Record<string, unknown> = {},
  ): Promise<MigrationRecord> {
    const db = this.prisma as any;
    const updated = await db.storeMigration.update({
      where: { id: migration.id },
      data: { state, ...extra },
    });
    this.logger.log(`store migration state id=${migration.id} state=${state}`);
    return updated as MigrationRecord;
  }

  private async requireStore(storeId: string, organizationId: string): Promise<{ id: string }> {
    const store = await this.prisma.store.findFirst({
      where: { id: storeId, organizationId },
      select: { id: true },
    });
    if (!store) {
      throw new NotFoundException('store not found');
    }
    return store;
  }

  private async activeNodeIds(clusterId: string): Promise<string[]> {
    const nodes = await this.prisma.node.findMany({
      where: { clusterId, status: { in: ACTIVE_NODE_STATUSES } },
      select: { id: true },
    });
    return nodes.map((node) => node.id);
  }

  private ackedNodeIds(value: unknown): string[] {
    return Array.isArray(value)
      ? [...new Set(value.filter((nodeId): nodeId is string => typeof nodeId === 'string'))]
      : [];
  }
}
