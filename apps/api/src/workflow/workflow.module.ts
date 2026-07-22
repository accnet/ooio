import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuditModule } from '../audit/audit.module';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { EventsModule } from '../events/events.module';
import { OperationsProcessor } from './operations.processor';
import { WORKFLOW_QUEUE, WorkflowService } from './workflow.service';

@Module({
  imports: [
    ConfigModule,
    AuditModule,
    SchedulerModule,
    EventsModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
        },
      }),
    }),
    BullModule.registerQueue({ name: WORKFLOW_QUEUE }),
  ],
  providers: [WorkflowService, OperationsProcessor],
  exports: [WorkflowService],
})
export class WorkflowModule {}
