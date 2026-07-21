import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { StoresController } from './stores.controller';
import { StoresService } from './stores.service';

@Module({
  imports: [AuthModule, SchedulerModule, WorkflowModule],
  controllers: [StoresController],
  providers: [StoresService],
  exports: [StoresService],
})
export class StoresModule {}
