import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { AuthenticatedRequest } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  NOTIFICATION_CHANNEL_TYPES,
  CreateNotificationChannelInput,
  NotificationChannelType,
} from './notification.types';
import { NotificationsService } from './notifications.service';

class CreateChannelBody implements CreateNotificationChannelInput {
  @IsIn([...NOTIFICATION_CHANNEL_TYPES])
  type!: NotificationChannelType;

  @IsString()
  @IsNotEmpty()
  target!: string;

  @IsOptional()
  @IsString()
  secret?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Post('channels')
  createChannel(@Body() body: CreateChannelBody, @Req() request: AuthenticatedRequest) {
    return this.notifications.createChannel(request.user.organizationId, body);
  }

  @Get('channels')
  listChannels(@Req() request: AuthenticatedRequest) {
    return this.notifications.listChannels(request.user.organizationId);
  }

  @Delete('channels/:id')
  deleteChannel(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.notifications.deleteChannel(id, request.user.organizationId);
  }

  @Get()
  list(
    @Req() request: AuthenticatedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.notifications.listNotifications(
      request.user.organizationId,
      this.parsePositiveInteger(page, 1),
      this.parsePositiveInteger(limit, 50),
    );
  }

  private parsePositiveInteger(value: string | undefined, fallback: number): number {
    const parsed = value === undefined ? fallback : Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }
}
