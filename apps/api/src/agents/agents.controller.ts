import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { AgentsService, AgentRegistrationInput, HeartbeatInput } from './agents.service';
import { OperationsService, JobResultInput } from '../operations/operations.service';

class RegistrationBody implements AgentRegistrationInput {
  @IsString()
  @IsNotEmpty()
  registrationToken!: string;

  @IsString()
  @IsNotEmpty()
  nodeId!: string;

  @IsString()
  @IsNotEmpty()
  hostname!: string;

  @IsObject()
  capabilities!: Record<string, boolean>;

  @IsObject()
  versions!: Record<string, string>;
}

class CapacityBody {
  @IsNumber()
  @Min(0)
  @Max(100)
  cpuPercent!: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  memoryPercent!: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  diskPercent!: number;

  @IsInt()
  @Min(0)
  siteCount!: number;
}

class HeartbeatBody implements HeartbeatInput {
  @IsString()
  @IsIn(['ready', 'busy', 'draining', 'maintenance'])
  status!: string;

  @IsObject()
  capabilities!: Record<string, boolean>;

  @IsObject()
  versions!: Record<string, string>;

  @ValidateNested()
  @Type(() => CapacityBody)
  capacity!: CapacityBody;

  @IsOptional()
  metrics?: unknown;
}

class JobErrorBody {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  message!: string;
}

class JobResultBody implements JobResultInput {
  @IsString()
  @IsIn(['succeeded', 'failed'])
  status!: 'succeeded' | 'failed';

  @IsOptional()
  result?: unknown;

  @IsOptional()
  @ValidateNested()
  @Type(() => JobErrorBody)
  error?: JobErrorBody;
}

@Controller('v1/agents')
export class AgentsController {
  constructor(
    private readonly agents: AgentsService,
    private readonly operations: OperationsService,
  ) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  register(@Body() body: RegistrationBody) {
    return this.agents.register(body);
  }

  // Contract v1: heartbeat returns 200 (NestJS would default POST to 201).
  @Post(':agentId/heartbeat')
  @HttpCode(HttpStatus.OK)
  heartbeat(@Param('agentId') agentId: string, @Body() body: HeartbeatBody) {
    return this.agents.heartbeat(agentId, body);
  }

  @Get(':agentId/jobs')
  jobs(@Param('agentId') agentId: string) {
    return this.operations.claimJobs(agentId);
  }

  @Post(':agentId/jobs/:jobId/result')
  @HttpCode(HttpStatus.ACCEPTED)
  result(
    @Param('agentId') agentId: string,
    @Param('jobId') jobId: string,
    @Body() body: JobResultBody,
  ) {
    return this.operations.completeJob(agentId, jobId, body);
  }
}
