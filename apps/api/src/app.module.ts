import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { AgentsModule } from './agents/agents.module';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { OrgsModule } from './orgs/orgs.module';
import { OperationsModule } from './operations/operations.module';
import { PrismaModule } from './prisma/prisma.module';
import { StoresModule } from './stores/stores.module';
import { AuditModule } from './audit/audit.module';
import { BillingModule } from './billing/billing.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { WorkflowModule } from './workflow/workflow.module';
import { DasModule } from './das/das.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: '.env',
    }),
    PrismaModule,
    AuthModule,
    OrgsModule,
    ApiKeysModule,
    BillingModule,
    AgentsModule,
    OperationsModule,
    StoresModule,
    AuditModule,
    SchedulerModule,
    WorkflowModule,
    DasModule,
    HealthModule,
  ],
})
export class AppModule {}
