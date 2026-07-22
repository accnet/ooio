import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';
import { AuthenticatedRequest } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AcknowledgeMigrationInput, CreateMigrationInput } from './migration.types';
import { MigrationsService } from './migrations.service';

class CreateMigrationBody implements CreateMigrationInput {
  @IsString()
  @IsNotEmpty()
  toPoolId!: string;

  @IsString()
  @IsNotEmpty()
  reason!: string;
}

class AcknowledgeMigrationBody implements AcknowledgeMigrationInput {
  @IsString()
  @IsNotEmpty()
  nodeId!: string;

  @IsInt()
  @Min(1)
  epoch!: number;
}

@Controller()
@UseGuards(JwtAuthGuard)
export class MigrationsController {
  constructor(private readonly migrations: MigrationsService) {}

  @Post('stores/:id/migrations')
  plan(
    @Param('id') storeId: string,
    @Body() body: CreateMigrationBody,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.migrations.plan(storeId, body, request.user.organizationId);
  }

  @Get('stores/:id/migrations')
  list(@Param('id') storeId: string, @Req() request: AuthenticatedRequest) {
    return this.migrations.list(storeId, request.user.organizationId);
  }

  @Get('migrations/:id')
  get(@Param('id') migrationId: string, @Req() request: AuthenticatedRequest) {
    return this.migrations.get(migrationId, request.user.organizationId);
  }

  @Post('migrations/:id/abort')
  abort(@Param('id') migrationId: string, @Req() request: AuthenticatedRequest) {
    return this.migrations.abort(migrationId, request.user.organizationId);
  }

  @Post('migrations/:id/ack')
  acknowledge(
    @Param('id') migrationId: string,
    @Body() body: AcknowledgeMigrationBody,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.migrations.acknowledge(migrationId, body, request.user.organizationId);
  }
}
