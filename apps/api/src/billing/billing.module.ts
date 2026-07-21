import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { PlansSeed } from './plans.seed';
import { QuotaService } from './quota.service';

@Global()
@Module({
  imports: [ConfigModule, AuthModule],
  controllers: [BillingController],
  providers: [BillingService, PlansSeed, QuotaService],
  exports: [BillingService, PlansSeed, QuotaService],
})
export class BillingModule {}
