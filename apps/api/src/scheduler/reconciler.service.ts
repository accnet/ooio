import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';

@Injectable()
export class ReconcilerService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;

  constructor(private readonly scheduler: SchedulerService) {}

  onModuleInit(): void {
    const interval = this.scheduler.placementConfig.reconciliationIntervalMs;
    this.timer = setInterval(() => {
      void this.scheduler.reconcilePending();
    }, interval);
    void this.scheduler.reconcilePending();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }
}
