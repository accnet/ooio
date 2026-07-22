import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsBoolean, IsObject, IsOptional, IsString } from 'class-validator';
import { AuthenticatedRequest } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformRole, PlatformRoleGuard } from '../auth/platform-role.guard';
import { FeatureFlagEvaluationQuery, FeatureFlagRules, UpsertFeatureFlagInput } from './flag.types';
import { FlagsService } from './flags.service';

class FeatureFlagBody implements UpsertFeatureFlagInput {
  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsObject()
  rules?: FeatureFlagRules;
}

class FeatureFlagQuery implements FeatureFlagEvaluationQuery {
  @IsOptional()
  @IsString()
  key?: string;

  @IsOptional()
  @IsString()
  clusterId?: string;

  @IsOptional()
  @IsString()
  version?: string;
}

@Controller('flags')
@UseGuards(JwtAuthGuard)
export class FlagsController {
  constructor(private readonly flags: FlagsService) {}

  @Get()
  @UseGuards(PlatformRoleGuard)
  @PlatformRole('operator')
  list() {
    return this.flags.list();
  }

  @Put(':key')
  @UseGuards(PlatformRoleGuard)
  @PlatformRole('operator')
  upsert(@Param('key') key: string, @Body() body: FeatureFlagBody) {
    return this.flags.upsert(key, body);
  }

  @Get('evaluate')
  evaluate(@Query() query: FeatureFlagQuery, @Req() request: AuthenticatedRequest) {
    return this.flags.evaluate(query, request.user.organizationId);
  }
}
