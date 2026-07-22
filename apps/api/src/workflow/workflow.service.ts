import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Prisma, Operation } from '@prisma/client';
import { Queue } from 'bullmq';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { SchedulerService } from '../scheduler/scheduler.service';
import { EventService } from '../events/events.service';
import {
  JobResultInput,
  OperationLogEntry,
  OperationPayload,
  OperationStatus,
  OperationType,
  isOperationType,
} from './operation-types';

export const WORKFLOW_QUEUE = 'workflow-operations';

export interface CreateOperationInput {
  organizationId: string;
  type: string;
  payload?: unknown;
  storeId?: string;
  actor?: string;
  maxAttempts?: number;
}

interface WorkflowQueueData {
  operationId: string;
}

@Injectable()
export class WorkflowService {
  private readonly logger = new Logger(WorkflowService.name);
  private readonly defaultMaxAttempts: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scheduler: SchedulerService,
    private readonly events: EventService,
    config: ConfigService,
    @InjectQueue(WORKFLOW_QUEUE) private readonly queue: Queue<WorkflowQueueData>,
  ) {
    const configured = Number(config.get<string | number>('OPERATION_MAX_ATTEMPTS', 3));
    this.defaultMaxAttempts = Number.isFinite(configured) ? Math.max(1, Math.floor(configured)) : 3;
  }

  async createOperation(input: CreateOperationInput): Promise<Operation & { maxAttempts: number }> {
    const type = input.type.trim();
    if (!isOperationType(type)) {
      throw new Error(`unsupported operation type: ${type}`);
    }
    const maxAttempts = this.normalizeMaxAttempts(input.maxAttempts);
    const payload = this.objectPayload(input.payload);
    const operation = await this.prisma.operation.create({
      data: {
        organizationId: input.organizationId,
        storeId: input.storeId,
        type,
        status: 'pending',
        progress: 0,
        attempts: 0,
        payload: payload as Prisma.InputJsonValue,
        logs: [{ event: 'created', at: new Date().toISOString(), actor: input.actor || 'system', maxAttempts }] as Prisma.InputJsonValue,
      },
    });
    await this.audit.recordOperationCreated({
      organizationId: operation.organizationId,
      operationId: operation.id,
      operationType: operation.type,
      actor: input.actor || 'system',
    });
    await this.enqueueDispatch(operation.id, maxAttempts);
    return { ...operation, maxAttempts };
  }

  async markRunning(operationId: string, actor: string): Promise<void> {
    await this.transition(operationId, 'running', actor, { event: 'leased' });
  }

  async completeOperation(operationId: string, input: JobResultInput, actor = 'agent'): Promise<Operation> {
    const operation = await this.requireOperation(operationId);
    if (input.status === 'succeeded') {
      const updated = await this.transition(operationId, 'succeeded', actor, {
        event: 'completed',
        progress: 100,
      }, input.result);
      return updated;
    }

    const errorMessage = input.error?.message || 'agent reported operation failure';
    const updated = await this.transition(operationId, 'failed', actor, {
      event: 'failed',
      message: errorMessage,
      progress: operation.progress,
    }, undefined, errorMessage);
    if (operation.attempts < this.maxAttempts(operation)) {
      await this.enqueueRetry(operation.id, this.maxAttempts(operation), operation.attempts);
    }
    if (operation.type === 'create-store') {
      await this.enqueueRollback(operation);
    }
    return updated;
  }

  async cancelOperation(operationId: string, actor: string): Promise<Operation> {
    const operation = await this.requireOperation(operationId);
    if (!['pending', 'running'].includes(operation.status)) {
      throw new ConflictException(`operation cannot be cancelled from ${operation.status}`);
    }
    return this.transition(operationId, 'cancelled', actor, { event: 'cancelled' });
  }

  async retryOperation(operationId: string, actor: string): Promise<Operation> {
    const operation = await this.requireOperation(operationId);
    if (!['failed', 'cancelled'].includes(operation.status)) {
      throw new ConflictException(`operation cannot be retried from ${operation.status}`);
    }
    const updated = await this.transition(operationId, 'pending', actor, {
      event: 'manual-retry',
      message: 'manual retry requested',
    }, undefined, null);
    await this.enqueueRetry(operation.id, this.maxAttempts(operation), operation.attempts);
    return updated;
  }

  async requeueOperation(operationId: string): Promise<void> {
    const operation = await this.requireOperation(operationId);
    if (operation.status !== 'failed') {
      return;
    }
    await this.transition(operationId, 'pending', 'workflow-worker', {
      event: 'retry',
      message: 'retry backoff elapsed',
    }, undefined, null);
    await this.scheduler.reconcilePending();
  }

  async dispatchOperation(operationId: string): Promise<void> {
    const operation = await this.requireOperation(operationId);
    if (operation.status !== 'pending') {
      return;
    }
    await this.appendLog(operation, {
      event: 'queued',
      at: new Date().toISOString(),
      message: 'available to an assigned agent',
    });
  }

  async getOperation(operationId: string, organizationId?: string): Promise<Operation & { maxAttempts: number }> {
    const operation = await this.requireOperation(operationId);
    if (organizationId && operation.organizationId !== organizationId) {
      throw new NotFoundException('operation not found');
    }
    return { ...operation, maxAttempts: this.maxAttempts(operation) };
  }

  async createStoreRollback(operation: Operation): Promise<void> {
    await this.enqueueRollback(operation);
  }

  private async enqueueRollback(operation: Operation): Promise<void> {
    if (!operation.storeId || this.hasLogEvent(operation, 'rollback-enqueued')) {
      return;
    }
    const payload = this.objectPayload(operation.payload);
    const rollback = await this.createOperation({
      organizationId: operation.organizationId,
      storeId: operation.storeId,
      type: 'delete-store',
      payload: { ...payload, compensatesOperationId: operation.id },
      actor: 'workflow-rollback',
    });
    await this.appendLog(operation, {
      event: 'rollback-enqueued',
      at: new Date().toISOString(),
      message: `compensating operation ${rollback.id}`,
    });
  }

  private async enqueueDispatch(operationId: string, maxAttempts: number): Promise<void> {
    await this.queue.add(
      'dispatch-operation',
      { operationId },
      {
        jobId: `dispatch-${operationId}`,
        attempts: maxAttempts,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 100,
        removeOnFail: 1000,
      },
    );
  }

  private async enqueueRetry(operationId: string, maxAttempts: number, attempts: number): Promise<void> {
    await this.queue.add(
      'retry-operation',
      { operationId },
      {
        jobId: `retry-${operationId}-${attempts}`,
        delay: this.retryDelay(attempts),
        attempts: maxAttempts,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 100,
        removeOnFail: 1000,
      },
    );
  }

  private async transition(
    operationId: string,
    status: OperationStatus,
    actor: string,
    log: Omit<OperationLogEntry, 'at'>,
    result?: unknown,
    error?: string | null,
  ): Promise<Operation> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const client = tx as Prisma.TransactionClient & {
        operation: {
          findUnique(args: { where: { id: string } }): Promise<Operation | null>;
          update(args: { where: { id: string }; data: Prisma.OperationUpdateInput }): Promise<Operation>;
        };
      };
      const operation = await client.operation.findUnique({ where: { id: operationId } });
      if (!operation) {
        throw new NotFoundException('operation not found');
      }
      const data: Prisma.OperationUpdateInput = {
        status,
        logs: [...this.logs(operation), { ...log, at: new Date().toISOString(), status }] as Prisma.InputJsonValue,
      };
      if (typeof log.progress === 'number') {
        data.progress = Math.min(100, Math.max(0, Math.floor(log.progress)));
      }
      if (result !== undefined) {
        data.result = result as Prisma.InputJsonValue;
      }
      if (error !== undefined) {
        data.error = error;
      }
      const changed = await client.operation.update({ where: { id: operationId }, data });

      // The Agent's blog ID is the runtime identity needed for pool mapping.
      // Persist it in this transaction so a successful operation cannot commit
      // without its corresponding Control Plane mapping metadata.
      if (operation.status !== 'succeeded' && status === 'succeeded' && operation.type === 'create-store' && operation.storeId) {
        const blogId = this.blogIdFromResult(result);
        if (blogId === null) {
          this.logger.warn(`create-store operation missing valid blogId; operation=${operation.id} store=${operation.storeId}`);
        }
        await tx.store.update({
          where: { id: operation.storeId },
          data: { blogId },
        });
      }
      if (operation.status !== status && (status === 'succeeded' || status === 'failed')) {
        await this.events.record(tx, {
          type: status === 'succeeded' ? 'OperationCompleted' : 'OperationFailed',
          aggregateType: 'operation',
          aggregateId: operation.id,
          payload: {
            operationId: operation.id,
            organizationId: operation.organizationId,
            operationType: operation.type,
            status,
            result: result === undefined ? null : result as Prisma.InputJsonValue,
            error: error || null,
          },
        });
      }
      return { changed, previous: operation };
    });
    if (updated.previous.status !== status) {
      await this.audit.recordOperationStatus({
        organizationId: updated.changed.organizationId,
        operationId,
        from: updated.previous.status,
        to: status,
        actor,
        metadata: { type: updated.changed.type },
      });
    }
    return updated.changed;
  }

  private async appendLog(operation: Operation, entry: OperationLogEntry): Promise<void> {
    await this.prisma.operation.update({
      where: { id: operation.id },
      data: { logs: [...this.logs(operation), entry] as Prisma.InputJsonValue },
    });
  }

  private async requireOperation(operationId: string): Promise<Operation> {
    const operation = await this.prisma.operation.findUnique({ where: { id: operationId } });
    if (!operation) {
      throw new NotFoundException('operation not found');
    }
    return operation;
  }

  private logs(operation: Operation): OperationLogEntry[] {
    if (Array.isArray(operation.logs)) {
      return (operation.logs as unknown[]).filter((entry) => Boolean(entry && typeof entry === 'object' && !Array.isArray(entry))) as OperationLogEntry[];
    }
    if (operation.logs && typeof operation.logs === 'object') {
      return [operation.logs as OperationLogEntry];
    }
    return [];
  }

  private hasLogEvent(operation: Operation, event: string): boolean {
    return this.logs(operation).some((entry) => entry.event === event);
  }

  private maxAttempts(operation: Operation): number {
    const entry = this.logs(operation).find((candidate) => typeof candidate.maxAttempts === 'number');
    return this.normalizeMaxAttempts(entry?.maxAttempts);
  }

  private normalizeMaxAttempts(value: number | undefined): number {
    const parsed = value === undefined ? this.defaultMaxAttempts : Number(value);
    return Number.isFinite(parsed) ? Math.max(1, Math.floor(parsed)) : this.defaultMaxAttempts;
  }

  private retryDelay(attempts: number): number {
    return Math.min(60000, 1000 * Math.pow(2, Math.max(0, attempts - 1)));
  }

  private objectPayload(payload: unknown): OperationPayload {
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      return payload as OperationPayload;
    }
    return {};
  }

  private blogIdFromResult(result: unknown): number | null {
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      return null;
    }
    const blogId = (result as Record<string, unknown>).blogId;
    return typeof blogId === 'number'
      && Number.isSafeInteger(blogId)
      && blogId > 0
      && blogId <= 2147483647
      ? blogId
      : null;
  }
}
