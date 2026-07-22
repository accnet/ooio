import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AnalyticsService } from './analytics.service';

@Controller('analytics')
@UseGuards(JwtAuthGuard)
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('overview')
  overview(@Req() request: AuthenticatedRequest) {
    return this.analytics.overview(request.user.organizationId, request.user.platformRole);
  }

  @Get('stores')
  stores(
    @Req() request: AuthenticatedRequest,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.analytics.stores(request.user.organizationId, from, to);
  }
}
