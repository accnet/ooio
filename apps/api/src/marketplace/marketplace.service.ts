import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WorkflowService } from '../workflow/workflow.service';
import {
  CreateDistributionInput,
  DistributionFilters,
  DistributionStatus,
  DeployDistributionInput,
} from './distribution.types';

export interface DistributionRecord {
  id: string;
  name: string;
  version: string;
  channel: string;
  artifactUrl: string;
  checksum: string;
  status: DistributionStatus;
  createdAt: Date;
  updatedAt: Date;
}

interface DistributionDelegate {
  findMany(args: { where?: Record<string, unknown>; orderBy?: Record<string, string> }): Promise<DistributionRecord[]>;
  findUnique(args: { where: { id?: string; name_version?: { name: string; version: string } } }): Promise<DistributionRecord | null>;
  create(args: { data: Record<string, unknown> }): Promise<DistributionRecord>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<DistributionRecord>;
}

interface ClusterDelegate {
  findUnique(args: { where: { id: string }; select?: Record<string, boolean> }): Promise<{ id: string } | null>;
}

interface MarketplacePrisma {
  distribution: DistributionDelegate;
  cluster: ClusterDelegate;
}

@Injectable()
export class MarketplaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflow: WorkflowService,
  ) {}

  async list(filters: DistributionFilters = {}): Promise<DistributionRecord[]> {
    const where: Record<string, unknown> = {};
    if (filters.name?.trim()) {
      where.name = filters.name.trim();
    }
    if (filters.channel) {
      where.channel = filters.channel;
    }
    if (filters.status) {
      where.status = filters.status;
    }

    return this.db().distribution.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(id: string): Promise<DistributionRecord> {
    const distribution = await this.db().distribution.findUnique({ where: { id } });
    if (!distribution) {
      throw new NotFoundException('distribution not found');
    }
    return distribution;
  }

  async register(input: CreateDistributionInput): Promise<DistributionRecord> {
    this.validateCreateInput(input);
    try {
      return await this.db().distribution.create({
        data: {
          name: input.name.trim(),
          version: input.version.trim(),
          channel: input.channel || 'stable',
          artifactUrl: input.artifactUrl.trim(),
          checksum: input.checksum.trim(),
          status: 'draft',
        },
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('distribution name and version already exist');
      }
      throw error;
    }
  }

  async publish(id: string): Promise<DistributionRecord> {
    const distribution = await this.get(id);
    if (distribution.status === 'published') {
      throw new ConflictException('distribution is already published');
    }
    if (distribution.status !== 'draft') {
      throw new ConflictException('only draft distributions can be published');
    }
    return this.db().distribution.update({
      where: { id },
      data: { status: 'published' },
    });
  }

  async update(
    id: string,
    input: Partial<CreateDistributionInput> & { status?: DistributionStatus },
  ): Promise<DistributionRecord> {
    const current = await this.get(id);
    const immutableFields = ['artifactUrl', 'checksum', 'version'] as const;
    if (current.status === 'published' && immutableFields.some((field) => input[field] !== undefined)) {
      throw new ConflictException('published distributions are immutable; create a new version');
    }
    if (current.status === 'published' && input.status !== undefined && input.status !== 'deprecated') {
      throw new ConflictException('published distributions may only transition to deprecated');
    }
    if (current.status === 'deprecated' && input.status !== undefined && input.status !== 'deprecated') {
      throw new ConflictException('deprecated distributions cannot be republished');
    }

    const data: Record<string, unknown> = {};
    for (const field of ['name', 'version', 'channel', 'artifactUrl', 'checksum', 'status'] as const) {
      const value = input[field];
      if (value !== undefined) {
        data[field] = typeof value === 'string' ? value.trim() : value;
      }
    }
    if (Object.keys(data).length === 0) {
      return current;
    }
    return this.db().distribution.update({ where: { id }, data });
  }

  async deploy(
    clusterId: string,
    input: DeployDistributionInput,
    organizationId: string,
    actor: string,
  ) {
    if (!clusterId.trim() || !input?.distributionId?.trim()) {
      throw new ConflictException('clusterId and distributionId are required');
    }
    const cluster = await this.db().cluster.findUnique({ where: { id: clusterId }, select: { id: true } });
    if (!cluster) {
      throw new NotFoundException('cluster not found');
    }
    const distribution = await this.get(input.distributionId);
    if (distribution.status !== 'published') {
      throw new ConflictException('only published distributions can be deployed');
    }

    const operation = await this.workflow.createOperation({
      organizationId,
      type: 'DeployDistribution',
      payload: {
        clusterId,
        distributionId: distribution.id,
        name: distribution.name,
        version: distribution.version,
        artifactUrl: distribution.artifactUrl,
        checksum: distribution.checksum,
      } as Prisma.InputJsonValue,
      actor,
    });
    return {
      operationId: operation.id,
      clusterId,
      distributionId: distribution.id,
      status: operation.status,
    };
  }

  private db(): MarketplacePrisma {
    return this.prisma as unknown as MarketplacePrisma;
  }

  private validateCreateInput(input: CreateDistributionInput): void {
    if (!input?.name?.trim() || !input.version?.trim() || !input.artifactUrl?.trim() || !input.checksum?.trim()) {
      throw new ConflictException('name, version, artifactUrl, and checksum are required');
    }
    if (input.channel && !['stable', 'beta'].includes(input.channel)) {
      throw new ConflictException('channel must be stable or beta');
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
