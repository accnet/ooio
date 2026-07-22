import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { EVENT_DELIVERY_QUEUE } from '../events/events.dispatcher';
import { EventDeliveryJob } from '../events/event.types';
import { NotificationsService } from './notifications.service';
import { NotificationDeliveryJob } from './notification.types';

export const NOTIFICATIONS_QUEUE = 'notifications';

@Processor(EVENT_DELIVERY_QUEUE)
export class NotificationsEventConsumer extends WorkerHost {
  constructor(
    private readonly notifications: NotificationsService,
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly queue: Queue<NotificationDeliveryJob>,
  ) {
    super();
  }

  async process(job: Job<EventDeliveryJob>): Promise<void> {
    if (job.name !== 'event') {
      return;
    }
    const notificationIds = await this.notifications.ensureForEvent(job.data.event);
    for (const notificationId of notificationIds) {
      await this.queue.add('deliver-notification', {
        notificationId,
        event: job.data.event,
      }, {
        jobId: `notification-${notificationId}`,
        attempts: this.notifications.maxDeliveryAttempts(),
        backoff: { type: 'exponential', delay: this.notifications.retryDelayMs() },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      });
    }
  }
}

@Processor(NOTIFICATIONS_QUEUE)
export class NotificationsDeliveryConsumer extends WorkerHost {
  constructor(private readonly notifications: NotificationsService) {
    super();
  }

  async process(job: Job<NotificationDeliveryJob>): Promise<void> {
    if (job.name !== 'deliver-notification') {
      return;
    }
    const maxAttempts = typeof job.opts.attempts === 'number' ? job.opts.attempts : 1;
    await this.notifications.deliver(job.data.notificationId, job.attemptsMade + 1, maxAttempts);
  }
}
