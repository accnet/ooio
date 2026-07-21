import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JobErrorInput, JobResultInput } from '../workflow/operation-types';
import { WorkflowService } from '../workflow/workflow.service';

export { JobErrorInput, JobResultInput } from '../workflow/operation-types';

@Injectable()
export class OperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflow: WorkflowService,
  ) {}

  async claimJobs(agentId: string): Promise<{ jobs: Array<Record<string, unknown>> }> {
    const node = await this.findNode(agentId);
    if (!node) {
      throw new NotFoundException('agent not found');
    }

    const operations = await this.prisma.operation.findMany({
      where: { status: 'pending', store: { is: { nodeId: node.id } } },
      orderBy: { createdAt: 'asc' },
    });
    const jobs: Array<Record<string, unknown>> = [];
    for (const operation of operations) {
      const leasedUntil = new Date(Date.now() + 5 * 60 * 1000);
      const claimed = await this.prisma.operation.updateMany({
        where: { id: operation.id, status: 'pending' },
        data: {
          attempts: { increment: 1 },
          logs: this.appendLeaseLog(operation.logs, leasedUntil),
        },
      });
      if (claimed.count !== 1) {
        continue;
      }
      await this.workflow.markRunning(operation.id, 'agent');
      jobs.push({
        id: operation.id,
        type: operation.type,
        payload: this.objectPayload(operation.payload),
        leasedUntil,
      });
    }
    return { jobs };
  }

  async completeJob(agentId: string, jobId: string, input: JobResultInput): Promise<{ accepted: true }> {
    const node = await this.findNode(agentId);
    if (!node) {
      throw new NotFoundException('agent not found');
    }
    this.validateResult(input);

    const operation = await this.prisma.operation.findUnique({ where: { id: jobId } });
    if (!operation) {
      throw new NotFoundException('job not found');
    }
    const store = operation.storeId
      ? await this.prisma.store.findUnique({ where: { id: operation.storeId } })
      : null;
    if (store?.nodeId && store.nodeId !== node.id) {
      throw new ConflictException('job is assigned to another agent');
    }

    await this.workflow.completeOperation(jobId, input, 'agent');
    if (store) {
      await this.prisma.store.update({
        where: { id: store.id },
        data: {
          status: input.status === 'succeeded'
            ? operation.type === 'delete-store' ? 'deleted' : 'active'
            : 'failed',
        },
      });
    }
    return { accepted: true };
  }

  async getOperation(id: string, organizationId?: string) {
    return this.workflow.getOperation(id, organizationId);
  }

  async cancelOperation(id: string, organizationId: string, actor: string) {
    const operation = await this.workflow.getOperation(id, organizationId);
    return this.workflow.cancelOperation(operation.id, actor);
  }

  async retryOperation(id: string, organizationId: string, actor: string) {
    const operation = await this.workflow.getOperation(id, organizationId);
    return this.workflow.retryOperation(operation.id, actor);
  }

  private async findNode(agentId: string) {
    const byId = await this.prisma.node.findUnique({ where: { id: agentId } });
    return byId ?? this.prisma.node.findUnique({ where: { nodeIdentifier: agentId } });
  }

  private validateResult(input: JobResultInput): void {
    if (input.status !== 'succeeded' && input.status !== 'failed') {
      throw new Error('job result status must be succeeded or failed');
    }
    if (input.status === 'failed' && (!input.error?.code?.trim() || !input.error.message?.trim())) {
      throw new Error('failed job result requires error code and message');
    }
  }

  private appendLeaseLog(logs: Prisma.JsonValue | null, leasedUntil: Date): Prisma.InputJsonValue {
    const entries = Array.isArray(logs)
      ? logs.filter((entry) => Boolean(entry && typeof entry === 'object' && !Array.isArray(entry)))
      : [];
    return [
      ...entries,
      { event: 'lease-requested', at: new Date().toISOString(), leasedUntil: leasedUntil.toISOString() },
    ] as Prisma.InputJsonValue;
  }

  private objectPayload(payload: Prisma.JsonValue | null): Record<string, unknown> {
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      return payload as Record<string, unknown>;
    }
    return {};
  }
}
