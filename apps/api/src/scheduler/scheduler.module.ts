import { Module } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { ReconcilerService } from './reconciler.service';

@Module({
  providers: [SchedulerService, ReconcilerService],
  exports: [SchedulerService],
})
export class SchedulerModule {}
