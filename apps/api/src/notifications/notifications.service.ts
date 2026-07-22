import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHmac } from 'node:crypto';
import { EventRecord } from '../events/event.types';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateNotificationChannelInput,
  NotificationChannelRecord,
  NotificationRecord,
} from './notification.types';

interface ChannelRow extends NotificationChannelRecord {
  secret: string | null;
}

interface NotificationWithRelations extends NotificationRecord {
  event: EventRecord;
  channel: ChannelRow;
}

interface ChannelDelegate {
  findMany(args: {
    where: Record<string, unknown>;
    orderBy?: Record<string, string>;
  }): Promise<ChannelRow[]>;
  findUnique(args: { where: { id: string } }): Promise<ChannelRow | null>;
  create(args: { data: Record<string, unknown> }): Promise<ChannelRow>;
  delete(args: { where: { id: string } }): Promise<ChannelRow>;
}

interface NotificationDelegate {
  findMany(args: {
    where: Record<string, unknown>;
    orderBy?: Record<string, string>;
    skip?: number;
    take?: number;
    include?: { event: boolean; channel: boolean };
  }): Promise<NotificationWithRelations[]>;
  findUnique(args: {
    where: { id?: string; eventId_channelId?: { eventId: string; channelId: string } };
    include?: { event: boolean; channel: boolean };
  }): Promise<NotificationWithRelations | NotificationRecord | null>;
  count(args: { where: Record<string, unknown> }): Promise<number>;
  create(args: { data: Record<string, unknown> }): Promise<NotificationRecord>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<NotificationRecord>;
}

interface NotificationsPrisma {
  notificationChannel: ChannelDelegate;
  notification: NotificationDelegate;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async createChannel(
    organizationId: string,
    input: CreateNotificationChannelInput,
  ): Promise<NotificationChannelRecord> {
    this.validateChannel(input);
    const channel = await this.db().notificationChannel.create({
      data: {
        organizationId,
        type: input.type,
        target: input.target.trim(),
        secret: input.type === 'webhook' ? input.secret?.trim() : null,
        enabled: input.enabled ?? true,
      },
    });
    return this.publicChannel(channel);
  }

  async listChannels(organizationId: string): Promise<NotificationChannelRecord[]> {
    const channels = await this.db().notificationChannel.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
    return channels.map((channel) => this.publicChannel(channel));
  }

  async deleteChannel(id: string, organizationId: string): Promise<{ deleted: true }> {
    const channel = await this.db().notificationChannel.findUnique({ where: { id } });
    if (!channel || channel.organizationId !== organizationId) {
      throw new NotFoundException('notification channel not found');
    }
    await this.db().notificationChannel.delete({ where: { id } });
    return { deleted: true };
  }

  async listNotifications(organizationId: string, pageInput = 1, limitInput = 50) {
    const page = this.positiveInteger(pageInput, 'page');
    const limit = Math.min(100, this.positiveInteger(limitInput, 'limit'));
    const channels = await this.db().notificationChannel.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
    });
    const channelIds = channels.map((channel) => channel.id);
    if (channelIds.length === 0) {
      return { notifications: [], page, limit, total: 0, totalPages: 0 };
    }
    const where = { channelId: { in: channelIds } };
    const [total, notifications] = await Promise.all([
      this.db().notification.count({ where }),
      this.db().notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { event: true, channel: true },
      }),
    ]);
    return {
      notifications: notifications.map((notification) => ({
        id: notification.id,
        eventId: notification.eventId,
        eventType: notification.event.type,
        channelId: notification.channelId,
        channelType: notification.channel.type,
        status: notification.status,
        attempts: notification.attempts,
        lastError: notification.lastError,
        createdAt: notification.createdAt,
        sentAt: notification.sentAt,
      })),
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    };
  }

  async ensureForEvent(event: EventRecord): Promise<string[]> {
    const organizationId = this.eventOrganizationId(event);
    if (!organizationId) {
      this.logger.warn(`event has no organization scope; notification skipped id=${event.id}`);
      return [];
    }
    const channels = await this.db().notificationChannel.findMany({
      where: { organizationId, enabled: true },
      orderBy: { createdAt: 'asc' },
    });
    const ids: string[] = [];
    for (const channel of channels) {
      try {
        const notification = await this.db().notification.create({
          data: { eventId: event.id, channelId: channel.id, status: 'pending' },
        });
        ids.push(notification.id);
      } catch (error) {
        if (!this.isUniqueViolation(error)) {
          throw error;
        }
        const existing = await this.db().notification.findUnique({
          where: { eventId_channelId: { eventId: event.id, channelId: channel.id } },
        });
        if (existing) {
          ids.push(existing.id);
        }
      }
    }
    return ids;
  }

  async deliver(notificationId: string, attempt: number, maxAttempts: number): Promise<void> {
    const notification = await this.db().notification.findUnique({
      where: { id: notificationId },
      include: { event: true, channel: true },
    });
    if (!notification || !('channel' in notification) || !('event' in notification)) {
      throw new NotFoundException('notification not found');
    }
    if (notification.status === 'sent') {
      return;
    }
    await this.db().notification.update({
      where: { id: notification.id },
      data: { attempts: { increment: 1 }, status: 'pending', lastError: null },
    });

    try {
      if (notification.channel.type === 'email') {
        this.logger.log(`email notification stub delivered id=${notification.id}`);
      } else {
        await this.sendWebhook(notification);
      }
      await this.db().notification.update({
        where: { id: notification.id },
        data: { status: 'sent', sentAt: new Date(), lastError: null },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const finalAttempt = attempt >= maxAttempts;
      await this.db().notification.update({
        where: { id: notification.id },
        data: { status: finalAttempt ? 'failed' : 'pending', lastError: message },
      });
      throw error;
    }
  }

  maxDeliveryAttempts(): number {
    const configured = Number(this.config.get<string | number>('NOTIFICATION_MAX_ATTEMPTS', 5));
    return Number.isFinite(configured) ? Math.max(1, Math.floor(configured)) : 5;
  }

  retryDelayMs(): number {
    const configured = Number(this.config.get<string | number>('NOTIFICATION_RETRY_DELAY_MS', 1000));
    return Number.isFinite(configured) ? Math.max(100, Math.floor(configured)) : 1000;
  }

  private async sendWebhook(notification: NotificationWithRelations): Promise<void> {
    const secret = notification.channel.secret;
    if (!secret) {
      throw new Error('webhook channel secret is missing');
    }
    const body = JSON.stringify({
      id: notification.event.id,
      type: notification.event.type,
      aggregateType: notification.event.aggregateType,
      aggregateId: notification.event.aggregateId,
      payload: notification.event.payload,
      occurredAt: notification.event.occurredAt,
    });
    const signature = createHmac('sha256', secret).update(body).digest('hex');
    const response = await fetch(notification.channel.target, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-woocloud-signature': `sha256=${signature}`,
      },
      body,
    });
    if (!response.ok) {
      throw new Error(`webhook returned HTTP ${response.status}`);
    }
  }

  private validateChannel(input: CreateNotificationChannelInput): void {
    if (!input || !['email', 'webhook'].includes(input.type)) {
      throw new ConflictException('type must be email or webhook');
    }
    if (!input.target?.trim()) {
      throw new ConflictException('target is required');
    }
    if (input.type === 'email' && !/^\S+@\S+\.\S+$/.test(input.target.trim())) {
      throw new ConflictException('target must be a valid email');
    }
    if (input.type === 'webhook') {
      let url: URL;
      try {
        url = new URL(input.target.trim());
      } catch {
        throw new ConflictException('webhook target must be a valid URL');
      }
      if (!['http:', 'https:'].includes(url.protocol)) {
        throw new ConflictException('webhook target must use HTTP or HTTPS');
      }
      if (!input.secret?.trim()) {
        throw new ConflictException('webhook secret is required for HMAC signing');
      }
    }
  }

  private eventOrganizationId(event: EventRecord): string | null {
    if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) {
      return null;
    }
    const organizationId = (event.payload as Record<string, unknown>).organizationId;
    return typeof organizationId === 'string' && organizationId.trim() ? organizationId.trim() : null;
  }

  private publicChannel(channel: ChannelRow): NotificationChannelRecord {
    const { secret: _secret, ...publicChannel } = channel;
    return publicChannel;
  }

  private positiveInteger(value: number, field: string): number {
    if (!Number.isInteger(value) || value < 1) {
      throw new ConflictException(`${field} must be a positive integer`);
    }
    return value;
  }

  private isUniqueViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }

  private db(): NotificationsPrisma {
    return this.prisma as unknown as NotificationsPrisma;
  }
}
