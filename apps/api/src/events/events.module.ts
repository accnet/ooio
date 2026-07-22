import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { EventsController } from './events.controller';
import { EventsDispatcher, EVENT_DELIVERY_QUEUE, EVENTS_QUEUE } from './events.dispatcher';
import { EventService } from './events.service';

@Module({
  imports: [
    ConfigModule,
    AuthModule,
    BullModule.registerQueue({ name: EVENTS_QUEUE }, { name: EVENT_DELIVERY_QUEUE }),
  ],
  controllers: [EventsController],
  providers: [EventService, EventsDispatcher],
  exports: [EventService],
})
export class EventsModule {}
