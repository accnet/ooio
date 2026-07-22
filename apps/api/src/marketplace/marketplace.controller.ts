import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsIn, IsNotEmpty, IsOptional, IsString, IsUrl } from 'class-validator';
import { AuthenticatedRequest } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformRole, PlatformRoleGuard } from '../auth/platform-role.guard';
import {
  DISTRIBUTION_CHANNELS,
  DISTRIBUTION_STATUSES,
  CreateDistributionInput,
  DistributionChannel,
  DistributionStatus,
  DeployDistributionInput,
} from './distribution.types';
import { MarketplaceService } from './marketplace.service';

class DistributionQuery {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsIn([...DISTRIBUTION_CHANNELS])
  channel?: DistributionChannel;

  @IsOptional()
  @IsIn([...DISTRIBUTION_STATUSES])
  status?: DistributionStatus;
}

class CreateDistributionBody implements CreateDistributionInput {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  version!: string;

  @IsOptional()
  @IsIn([...DISTRIBUTION_CHANNELS])
  channel?: DistributionChannel;

  @IsUrl({ require_protocol: true })
  artifactUrl!: string;

  @IsString()
  @IsNotEmpty()
  checksum!: string;
}

class DeployDistributionBody implements DeployDistributionInput {
  @IsString()
  @IsNotEmpty()
  distributionId!: string;
}

@Controller()
@UseGuards(JwtAuthGuard)
export class MarketplaceController {
  constructor(private readonly marketplace: MarketplaceService) {}

  @Get('distributions')
  list(@Query() query: DistributionQuery) {
    return this.marketplace.list(query);
  }

  @Get('distributions/:id')
  get(@Param('id') id: string) {
    return this.marketplace.get(id);
  }

  @Post('distributions')
  @UseGuards(PlatformRoleGuard)
  @PlatformRole('operator')
  register(@Body() body: CreateDistributionBody) {
    return this.marketplace.register(body);
  }

  @Post('distributions/:id/publish')
  @UseGuards(PlatformRoleGuard)
  @PlatformRole('operator')
  publish(@Param('id') id: string) {
    return this.marketplace.publish(id);
  }

  @Post('clusters/:id/deploy-distribution')
  @UseGuards(PlatformRoleGuard)
  @PlatformRole('operator')
  deploy(
    @Param('id') clusterId: string,
    @Body() body: DeployDistributionBody,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.marketplace.deploy(
      clusterId,
      body,
      request.user.organizationId,
      request.user.userId || request.user.authType,
    );
  }
}
