import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventDelegate, EventRecord, EventTransactionClient, RecordEventInput } from './event.types';

type PrismaWithEvents = PrismaService & { event: EventDelegate };

@Injectable()
export class EventService {
  constructor(private readonly prisma: PrismaService) {}

  async record(tx: Prisma.TransactionClient, input: RecordEventInput): Promise<EventRecord> {
    const client = tx as EventTransactionClient;
    return client.event.create({
      data: {
        ...input,
        occurredAt: input.occurredAt || new Date(),
      },
    });
  }

  async list(input: {
    page: number;
    limit: number;
    type?: string;
    aggregateId?: string;
    deliveryStatus?: string;
    organizationId?: string;
    platformRole?: string | null;
  }): Promise<{ events: EventRecord[]; page: number; limit: number; total: number; totalPages: number }> {
    const page = Math.max(1, Math.floor(input.page));
    const limit = Math.min(100, Math.max(1, Math.floor(input.limit)));
    const where: Record<string, unknown> = {};
    if (input.type?.trim()) {
      where.type = input.type.trim();
    }
    if (input.aggregateId?.trim()) {
      where.aggregateId = input.aggregateId.trim();
    }
    if (input.deliveryStatus?.trim()) {
      const deliveryStatus = input.deliveryStatus.trim();
      if (['pending', 'published', 'failed'].includes(deliveryStatus)) {
        where.deliveryStatus = deliveryStatus;
      }
    }
    if (input.platformRole !== 'operator') {
      if (!input.organizationId?.trim()) {
        return { events: [], page, limit, total: 0, totalPages: 0 };
      }
      where.payload = {
        path: ['organizationId'],
        equals: input.organizationId.trim(),
      };
    }

    const client = this.prisma as PrismaWithEvents;
    const [total, events] = await Promise.all([
      client.event.count({ where }),
      client.event.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return {
      events,
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    };
  }
}
