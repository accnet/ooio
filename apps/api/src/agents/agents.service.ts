import { Injectable, NotFoundException } from '@nestjs/common';
import { Node, Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SchedulerService } from '../scheduler/scheduler.service';

export interface AgentRegistrationInput {
  registrationToken: string;
  nodeId: string;
  hostname: string;
  capabilities: Record<string, boolean>;
  versions: Record<string, string>;
}

export interface HeartbeatInput {
  status: string;
  capabilities: Record<string, boolean>;
  versions: Record<string, string>;
  capacity: {
    cpuPercent: number;
    memoryPercent: number;
    diskPercent: number;
    siteCount: number;
  };
  metrics?: unknown;
}

export interface AgentRegistrationResponse {
  agentId: string;
  accessToken: string;
  expiresIn: number;
}

export interface HeartbeatResponse {
  acceptedAt: Date;
  pollAfterSeconds: number;
}

@Injectable()
export class AgentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduler: SchedulerService,
  ) {}

  async register(input: AgentRegistrationInput): Promise<AgentRegistrationResponse> {
    this.validateRegistration(input);

    const cluster = await this.prisma.cluster.upsert({
      where: { name: 'default' },
      create: { name: 'default', region: 'default' },
      update: {},
    });
    const node = await this.prisma.node.upsert({
      where: { nodeIdentifier: input.nodeId },
      create: {
        clusterId: cluster.id,
        nodeIdentifier: input.nodeId,
        hostname: input.hostname,
        version: input.versions.agent,
        status: 'ready',
        capabilities: this.manifestJson(input.capabilities, input.versions),
      },
      update: {
        clusterId: cluster.id,
        hostname: input.hostname,
        version: input.versions.agent,
        status: 'ready',
        capabilities: this.manifestJson(input.capabilities, input.versions),
      },
    });
    await this.scheduler.reconcilePending();

    return {
      agentId: node.id,
      accessToken: randomBytes(32).toString('hex'),
      expiresIn: 3600,
    };
  }

  async heartbeat(agentId: string, input: HeartbeatInput): Promise<HeartbeatResponse> {
    if (!agentId.trim()) {
      throw new NotFoundException('agent not found');
    }
    this.validateHeartbeat(input);

    const node = await this.findNode(agentId);
    if (!node) {
      throw new NotFoundException('agent not found');
    }

    const acceptedAt = new Date();
    await this.prisma.node.update({
      where: { id: node.id },
      data: {
        status: input.status,
        health: input.status,
        version: input.versions.agent,
        capabilities: this.manifestJson(input.capabilities, input.versions),
        capacity: input.capacity as unknown as Prisma.InputJsonValue,
        lastHeartbeatAt: acceptedAt,
      },
    });

    return { acceptedAt, pollAfterSeconds: 10 };
  }

  async findNode(agentId: string): Promise<Node | null> {
    const byId = await this.prisma.node.findUnique({ where: { id: agentId } });
    if (byId) {
      return byId;
    }
    return this.prisma.node.findUnique({ where: { nodeIdentifier: agentId } });
  }

  private validateRegistration(input: AgentRegistrationInput): void {
    if (!input || !input.registrationToken?.trim() || !input.nodeId?.trim() || !input.hostname?.trim()) {
      throw new Error('registrationToken, nodeId, and hostname are required');
    }
    if (!input.capabilities || typeof input.capabilities !== 'object') {
      throw new Error('capabilities is required');
    }
    if (!input.versions || typeof input.versions !== 'object' || !input.versions.agent?.trim()) {
      throw new Error('versions.agent is required');
    }
  }

  private validateHeartbeat(input: HeartbeatInput): void {
    const statuses = ['ready', 'busy', 'draining', 'maintenance'];
    if (!input || !statuses.includes(input.status)) {
      throw new Error('status must be one of ready, busy, draining, maintenance');
    }
    if (!input.capabilities || !input.versions?.agent || !input.capacity) {
      throw new Error('capabilities, versions.agent, and capacity are required');
    }
    for (const [name, value] of Object.entries(input.capacity)) {
      if (name !== 'siteCount' && (value < 0 || value > 100)) {
        throw new Error(`capacity.${name} must be between 0 and 100`);
      }
      if (name === 'siteCount' && value < 0) {
        throw new Error('capacity.siteCount must be non-negative');
      }
    }
  }

  private manifestJson(
    capabilities: Record<string, boolean>,
    versions: Record<string, string>,
  ): Prisma.InputJsonValue {
    // The foundation schema exposes one JSON capability column and one agent
    // version scalar; retain the v1 manifest fields in that JSON value.
    return { ...capabilities, versions } as unknown as Prisma.InputJsonValue;
  }
}
