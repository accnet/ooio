import { Prisma } from '@prisma/client';

export interface RecordEventInput {
  type: string;
  aggregateType: string;
  aggregateId: string;
  payload: Prisma.InputJsonValue;
  occurredAt?: Date;
}

export interface EventRecord {
  id: string;
  type: string;
  aggregateType: string;
  aggregateId: string;
  payload: Prisma.JsonValue;
  occurredAt: Date;
  publishedAt: Date | null;
  deliveryStatus?: string;
  attempts: number;
  lastError: string | null;
}

export interface EventDelegate {
  create(args: { data: RecordEventInput }): Promise<EventRecord>;
  count(args: { where?: Record<string, unknown> }): Promise<number>;
  findMany(args: {
    where?: Record<string, unknown>;
    orderBy?: Record<string, string>;
    skip?: number;
    take?: number;
  }): Promise<EventRecord[]>;
  updateMany(args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<{ count: number }>;
  update(args: {
    where: Record<string, string>;
    data: Record<string, unknown>;
  }): Promise<EventRecord>;
}

export type EventTransactionClient = Prisma.TransactionClient & { event: EventDelegate };

export interface EventDeliveryJob {
  event: EventRecord;
}
