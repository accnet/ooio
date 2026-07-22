export const NOTIFICATION_CHANNEL_TYPES = ['email', 'webhook'] as const;
export type NotificationChannelType = (typeof NOTIFICATION_CHANNEL_TYPES)[number];

export const NOTIFICATION_STATUSES = ['pending', 'sent', 'failed'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export interface CreateNotificationChannelInput {
  type: NotificationChannelType;
  target: string;
  secret?: string;
  enabled?: boolean;
}

export interface NotificationChannelRecord {
  id: string;
  organizationId: string;
  type: NotificationChannelType;
  target: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface NotificationRecord {
  id: string;
  eventId: string;
  channelId: string;
  status: NotificationStatus;
  attempts: number;
  lastError: string | null;
  createdAt: Date;
  sentAt: Date | null;
}

export interface NotificationDeliveryJob {
  notificationId: string;
  event: EventRecord;
}
import { EventRecord } from '../events/event.types';
