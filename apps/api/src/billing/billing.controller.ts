import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { IsNotEmpty, IsString } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard, Roles } from '../auth/rbac.guard';
import { BillingService } from './billing.service';
import { QuotaService } from './quota.service';

class ChangeSubscriptionBody {
  @IsString()
  @IsNotEmpty()
  planId!: string;
}

@Controller()
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly quota: QuotaService,
  ) {}

  @Get('plans')
  listPlans() {
    return this.billing.listPlans();
  }

  @Post('orgs/:id/subscription')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Roles('owner', 'admin')
  changeSubscription(@Param('id') organizationId: string, @Body() body: ChangeSubscriptionBody) {
    return this.billing.changeSubscription(organizationId, body.planId);
  }

  @Get('orgs/:id/subscription')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Roles('owner', 'admin', 'member')
  getSubscription(@Param('id') organizationId: string) {
    return this.billing.getSubscription(organizationId);
  }

  @Get('orgs/:id/usage')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @Roles('owner', 'admin', 'member')
  getUsage(@Param('id') organizationId: string) {
    return this.quota.getUsage(organizationId);
  }
}
