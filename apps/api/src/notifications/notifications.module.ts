import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { EventsModule } from '../events/events.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsDeliveryConsumer, NotificationsEventConsumer, NOTIFICATIONS_QUEUE } from './notifications.consumer';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [
    ConfigModule,
    AuthModule,
    EventsModule,
    BullModule.registerQueue({ name: NOTIFICATIONS_QUEUE }),
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsEventConsumer, NotificationsDeliveryConsumer],
  exports: [NotificationsService],
})
export class NotificationsModule {}
