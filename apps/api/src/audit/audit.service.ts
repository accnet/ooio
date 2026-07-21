import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async recordOperationStatus(input: {
    organizationId: string;
    operationId: string;
    from: string;
    to: string;
    actor: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        organizationId: input.organizationId,
        action: `operation.${input.to}`,
        resourceType: 'operation',
        resourceId: input.operationId,
        metadata: {
          from: input.from,
          to: input.to,
          actor: input.actor,
          ...(input.metadata || {}),
        } as Prisma.InputJsonValue,
      },
    });
  }

  async recordOperationCreated(input: {
    organizationId: string;
    operationId: string;
    operationType: string;
    actor: string;
  }): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        organizationId: input.organizationId,
        action: 'operation.created',
        resourceType: 'operation',
        resourceId: input.operationId,
        metadata: {
          type: input.operationType,
          actor: input.actor,
        } as Prisma.InputJsonValue,
      },
    });
  }
}
