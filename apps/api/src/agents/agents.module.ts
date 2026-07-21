import { Module } from '@nestjs/common';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';
import { OperationsModule } from '../operations/operations.module';
import { SchedulerModule } from '../scheduler/scheduler.module';

@Module({
  imports: [OperationsModule, SchedulerModule],
  controllers: [AgentsController],
  providers: [AgentsService],
  exports: [AgentsService],
})
export class AgentsModule {}
