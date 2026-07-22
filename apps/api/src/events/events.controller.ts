import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { EventService } from './events.service';

@Controller('events')
@UseGuards(JwtAuthGuard)
export class EventsController {
  constructor(private readonly events: EventService) {}

  @Get()
  list(
    @Req() request: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('type') type?: string,
    @Query('aggregateId') aggregateId?: string,
    @Query('status') status?: string,
  ) {
    return this.events.list({
      page: this.parsePositiveInteger(page, 1),
      limit: this.parsePositiveInteger(limit, 50),
      type,
      aggregateId,
      deliveryStatus: status,
      organizationId: request.user.organizationId,
      platformRole: request.user.platformRole,
    });
  }

  private parsePositiveInteger(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }
}
