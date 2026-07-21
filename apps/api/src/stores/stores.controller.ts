import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { IsEmail, IsIn, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';
import { AuthenticatedRequest } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateStoreInput, StoresService } from './stores.service';
import { OPERATION_TYPES } from '../workflow/operation-types';

class CreateStoreBody implements CreateStoreInput {
  @IsString()
  @IsNotEmpty()
  domain!: string;

  @IsString()
  @IsNotEmpty()
  path!: string;

  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsEmail()
  adminEmail!: string;
}

class CreateOperationBody {
  @IsString()
  @IsIn([...OPERATION_TYPES])
  type!: string;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}

@Controller('stores')
@UseGuards(JwtAuthGuard)
export class StoresController {
  constructor(private readonly stores: StoresService) {}

  @Post()
  create(@Body() body: CreateStoreBody, @Req() request: AuthenticatedRequest) {
    return this.stores.create(body, request.user.organizationId);
  }

  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return this.stores.list(request.user.organizationId);
  }

  @Post(':id/operations')
  createOperation(
    @Param('id') storeId: string,
    @Body() body: CreateOperationBody,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.stores.createOperation(storeId, body, request.user.organizationId, request.user.userId || request.user.authType);
  }
}
