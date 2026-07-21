import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DB_POOL_STATUSES, DbPoolStatus, RegisterPoolInput } from './allocation.types';
import { DatabaseAllocationService } from './das.service';

class RegisterPoolBody implements RegisterPoolInput {
  @IsString()
  @IsNotEmpty()
  clusterId!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  host!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @IsString()
  @IsNotEmpty()
  databaseName!: string;

  @IsString()
  @IsNotEmpty()
  username!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  secretRef?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  capacity?: number;

  @IsOptional()
  @IsIn([...DB_POOL_STATUSES])
  status?: DbPoolStatus;
}

class UpdatePoolStatusBody {
  @IsIn([...DB_POOL_STATUSES])
  status!: DbPoolStatus;
}

@Controller()
@UseGuards(JwtAuthGuard)
export class DasController {
  constructor(private readonly das: DatabaseAllocationService) {}

  @Get('pools')
  listPools(@Query('clusterId') clusterId?: string) {
    return this.das.listPools(clusterId);
  }

  @Get('pools/:id')
  getPool(@Param('id') id: string) {
    return this.das.getPool(id);
  }

  @Post('pools')
  registerPool(@Body() body: RegisterPoolBody) {
    return this.das.registerPool(body);
  }

  @Patch('pools/:id/status')
  updatePoolStatus(@Param('id') id: string, @Body() body: UpdatePoolStatusBody) {
    return this.das.updatePoolStatus(id, body.status);
  }

  @Get('clusters/:id/mapping-epoch')
  getMappingEpoch(@Param('id') clusterId: string) {
    return this.das.getMappingEpoch(clusterId);
  }
}
