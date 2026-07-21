import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OperationsService } from './operations.service';

@Controller('operations')
@UseGuards(JwtAuthGuard)
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  @Get(':id')
  get(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.operations.getOperation(id, request.user.organizationId);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.operations.cancelOperation(id, request.user.organizationId, request.user.userId || request.user.authType);
  }

  @Post(':id/retry')
  retry(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.operations.retryOperation(id, request.user.organizationId, request.user.userId || request.user.authType);
  }
}
