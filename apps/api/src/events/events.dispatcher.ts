import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { EventDelegate, EventDeliveryJob, EventRecord } from './event.types';

export const EVENTS_QUEUE = 'events-dispatch';
export const EVENT_DELIVERY_QUEUE = 'events-delivery';

type PrismaWithEvents = PrismaService & { event: EventDelegate };

@Injectable()
@Processor(EVENTS_QUEUE)
export class EventsDispatcher extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(EventsDispatcher.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @InjectQueue(EVENTS_QUEUE) private readonly queue: Queue,
    @InjectQueue(EVENT_DELIVERY_QUEUE) private readonly deliveryQueue: Queue<EventDeliveryJob>,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    const configured = Number(this.config.get<string | number>('EVENT_DISPATCH_INTERVAL_MS', 5000));
    const every = Number.isFinite(configured) ? Math.max(1000, Math.floor(configured)) : 5000;
    await this.queue.add('dispatch-events', {}, {
      jobId: 'dispatch-events',
      repeat: { every },
      removeOnComplete: 100,
      removeOnFail: 1000,
    });
  }

  async process(_job: Job): Promise<void> {
    await this.dispatchPending();
  }

  async dispatchPending(limit = 100): Promise<number> {
    const client = this.prisma as PrismaWithEvents;
    const maxAttempts = this.maxDeliveryAttempts();
    const pending = await client.event.findMany({
      where: { publishedAt: null, deliveryStatus: 'pending' },
      orderBy: { occurredAt: 'asc' },
      take: limit,
    });
    let published = 0;

    for (const event of pending) {
      if (event.attempts >= maxAttempts) {
        const failed = await client.event.updateMany({
          where: {
            id: event.id,
            publishedAt: null,
            deliveryStatus: 'pending',
            attempts: { gte: maxAttempts },
          },
          data: {
            deliveryStatus: 'failed',
            lastError: event.lastError || `delivery attempt limit of ${maxAttempts} reached`,
          },
        });
        if (failed.count === 1) {
          this.logger.error(`event delivery exhausted id=${event.id} attempts=${event.attempts}`);
        }
        continue;
      }

      const attempt = event.attempts + 1;
      const claimed = await client.event.updateMany({
        where: {
          id: event.id,
          publishedAt: null,
          deliveryStatus: 'pending',
          attempts: { lt: maxAttempts },
        },
        data: { attempts: { increment: 1 }, lastError: null },
      });
      if (claimed.count !== 1) {
        continue;
      }

      try {
        await this.deliveryQueue.add('event', { event }, {
          jobId: `event-${event.id}-${attempt}`,
          removeOnComplete: 1000,
          removeOnFail: 5000,
        });
        await client.event.update({
          where: { id: event.id },
          data: { publishedAt: new Date(), deliveryStatus: 'published', lastError: null },
        });
        published += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await client.event.update({
          where: { id: event.id },
          data: {
            lastError: message,
            ...(attempt >= maxAttempts ? { deliveryStatus: 'failed' } : {}),
          },
        });
        if (attempt >= maxAttempts) {
          this.logger.error(`event delivery exhausted id=${event.id} attempts=${attempt}: ${message}`);
        }
      }
    }
    return published;
  }

  private maxDeliveryAttempts(): number {
    const configured = Number(this.config.get<string | number>('EVENT_MAX_DELIVERY_ATTEMPTS', 10));
    return Number.isFinite(configured) ? Math.max(1, Math.floor(configured)) : 10;
  }
}
