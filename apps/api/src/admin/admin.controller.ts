import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformRole, PlatformRoleGuard } from '../auth/platform-role.guard';
import { AdminService } from './admin.service';
import { AdminListQuery } from './admin.types';

// Support may see owner email and organization names for customer assistance.
// Never return password hashes, refresh tokens, API-key hashes, secret refs, or
// infrastructure placement fields from this cross-tenant read surface.
@Controller('admin')
@UseGuards(JwtAuthGuard, PlatformRoleGuard)
@PlatformRole('support')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('organizations')
  listOrganizations(@Query() query: AdminListQuery, @Req() request: AuthenticatedRequest) {
    return this.admin.listOrganizations(query, this.actor(request));
  }

  @Get('organizations/:id')
  getOrganization(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.admin.getOrganization(id, this.actor(request));
  }

  @Get('stores')
  listStores(
    @Query() query: AdminListQuery,
    @Query('missingBlogId') missingBlogId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.admin.listStores(query, this.actor(request), missingBlogId);
  }

  private actor(request: AuthenticatedRequest) {
    return {
      userId: request.user.userId,
      organizationId: request.user.organizationId,
    };
  }
}
